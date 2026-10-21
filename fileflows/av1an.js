/**
 * @description Av1an script with Target Quality and intelligent aspect-ratio-aware downscaling.
 * @param {string} Metric The target metric to use (ssimulacra2, cvvdp, vmaf)
 * @param {int} TargetQuality The target integer score (e.g., 80)
 * @param {string} Encoder The video encoder to use (svt-av1, aom, rav1e)
 * @param {string} VideoParams Base encoder parameters (e.g., --preset 6)
 * @param {string} EncoderArgs A '|' separated list of additional encoder options
 * @param {bool} ProbeSlow Use the same params for probes as the final chunks
 * @param {string} ProbeParams Faster params for probes if ProbeSlow is false
 * @param {int} MaxProbes Maximum number of probes allowed
 * @param {string} ProbeRes Manual WxH resolution (Overrides ProbeHeight if set)
 * @param {int} ProbeHeight Target height for auto-downscaling (e.g., 720). Omit if input is smaller.
 * @param {string} Scaler Scaler for scene detection and metrics (lanczos3, bicubic)
 * @param {string} VspipeArgs Additional arguments for vspipe (comma separated)
 * @output Success - The file was encoded and working file updated
 * @output Failure - There was an error
 */
function Script(Metric, TargetQuality, Encoder, VideoParams, EncoderArgs, ProbeSlow, ProbeParams, MaxProbes, ProbeRes, ProbeHeight, Scaler, VspipeArgs)
{
    let av1an = 'av1an';
    let input = Flow.WorkingFile;
    let output = Flow.TempPath + '/' + Flow.NewGuid() + '.mkv';
    let av1anTemp = Flow.TempPath + '/av1an-' + Flow.NewGuid();
    let logLocation = Flow.TempPath + '/av1an/log'

    // --- Colour / HDR helpers ---
    // ffprobe name -> SVT-AV1 numeric (H.273) value. Anything not listed is left untagged.
    const primariesMap = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte431: 11, smpte432: 12 };
    const transferMap  = { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13, smpte2084: 16, 'arib-std-b67': 18 };
    const matrixMap    = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020nc: 9, bt2020c: 10 };

    // "35400/50000" -> 0.708
    function toFrac(v) {
        if (v === undefined || v === null) return NaN;
        let s = String(v);
        let p = s.split('/');
        if (p.length === 2) {
            let n = parseFloat(p[0]);
            let d = parseFloat(p[1]);
            return d !== 0 ? n / d : NaN;
        }
        return parseFloat(s);
    }

    // Reads colour tags, mastering display and content light level from the first frame/stream.
    // Returns null on any failure (never throws for ffprobe problems).
    function probeColor(file) {
        let ffprobe = Flow.GetToolPath('ffprobe') || 'ffprobe';
        let r = Flow.Execute({
            command: ffprobe,
            argumentList: ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1',
                           '-show_streams', '-show_frames', '-of', 'json', file]
        });
        if (r.exitCode !== 0) {
            Logger.WLog(`ffprobe failed (exit ${r.exitCode}) on ${file}`);
            return null;
        }
        let j = JSON.parse(r.standardOutput || r.output || '{}');
        let st = (j.streams && j.streams[0]) || {};
        let fr = (j.frames && j.frames[0]) || {};

        let pick = function (k) {
            if (st[k] && st[k] !== 'unknown') return st[k];
            if (fr[k] && fr[k] !== 'unknown') return fr[k];
            return '';
        };

        let side = [].concat(fr.side_data_list || [], st.side_data_list || []);
        let sideTypes = side.map(function (s) { return s.side_data_type || ''; });

        let md = null;
        let cll = null;
        for (let i = 0; i < side.length; i++) {
            let s = side[i];
            if (!md && s.side_data_type === 'Mastering display metadata' && s.red_x !== undefined) {
                let m = {
                    rx: toFrac(s.red_x), ry: toFrac(s.red_y),
                    gx: toFrac(s.green_x), gy: toFrac(s.green_y),
                    bx: toFrac(s.blue_x), by: toFrac(s.blue_y),
                    wx: toFrac(s.white_point_x), wy: toFrac(s.white_point_y),
                    minL: toFrac(s.min_luminance), maxL: toFrac(s.max_luminance)
                };
                let ok = true;
                for (let k in m) { if (!isFinite(m[k])) ok = false; }
                if (ok) md = m;
                else Logger.WLog('Mastering display metadata present but could not be parsed; ignoring it.');
            }
            if (!cll && s.side_data_type === 'Content light level metadata' && s.max_content !== undefined) {
                let c = { maxCll: Number(s.max_content), maxFall: Number(s.max_average) };
                if (isFinite(c.maxCll) && isFinite(c.maxFall)) cll = c;
            }
        }

        return {
            primaries: pick('color_primaries'),
            transfer: pick('color_transfer'),
            matrix: pick('color_space'),
            range: pick('color_range'),
            mastering: md,
            cll: cll,
            sideTypes: sideTypes
        };
    }

        // Writes the Matroska Colour element (tags, mastering display, MaxCLL/MaxFALL) into the container.
    // av1an's final mux doesn't do this, so players/servers that read container tags may not flag HDR.
    // Edits the file in place with mkvpropedit. Never throws; returns true on success.
    function writeContainerColor(file, c) {
        let tool = '';
        try { tool = Flow.GetToolPath('mkvpropedit'); } catch (e) { tool = ''; }
        tool = tool || 'mkvpropedit';

        let l = Flow.Execute({ command: tool, argumentList: ['--list-property-names'] });
        if (l.exitCode !== 0) {
            Logger.WLog(`mkvpropedit not usable (exit ${l.exitCode}); container colour tags not written.`);
            return false;
        }
        let known = l.standardOutput || l.output || '';
        let has = function (n) { return new RegExp(n + '\\s*\\|').test(known); };
        
        let sets = [];
        // names = candidate spellings (mkvtoolnix uses "color-", but check both)
        let add = function (names, value) {
            if (value === undefined || value === null) return;
            if (typeof value === 'number' && !isFinite(value)) return;
            for (const n of names) {
                if (has(n)) { sets.push('--set', `${n}=${value}`); return; }
            }
            Logger.WLog(`mkvpropedit has none of [${names.join(', ')}]; skipping that field.`);
        };
        let r5 = function (v) { return Number(v.toFixed(4)); };

        // H.273 numbers are the same values Matroska uses.
        add(['color-primaries', 'colour-primaries'], primariesMap[c.primaries]);
        add(['color-transfer-characteristics', 'colour-transfer-characteristics'], transferMap[c.transfer]);
        add(['color-matrix-coefficients', 'colour-matrix-coefficients'], matrixMap[c.matrix]);
        // Matroska range: 0 unspecified, 1 broadcast (tv), 2 full (pc)
        add(['color-range', 'colour-range'], c.range === 'tv' ? 1 : (c.range === 'pc' ? 2 : undefined));

        let isHdr = c.transfer === 'smpte2084' || c.transfer === 'arib-std-b67';
        if (isHdr) {
            if (c.cll) {
                add(['max-content-light'], c.cll.maxCll);
                add(['max-frame-light'], c.cll.maxFall);
            }
            if (c.mastering) {
                let m = c.mastering;
                add(['chromaticity-coordinates-red-x'],   r5(m.rx));
                add(['chromaticity-coordinates-red-y'],   r5(m.ry));
                add(['chromaticity-coordinates-green-x'], r5(m.gx));
                add(['chromaticity-coordinates-green-y'], r5(m.gy));
                add(['chromaticity-coordinates-blue-x'],  r5(m.bx));
                add(['chromaticity-coordinates-blue-y'],  r5(m.by));
                add(['white-coordinates-x', 'white-point-coordinates-x'], r5(m.wx));
                add(['white-coordinates-y', 'white-point-coordinates-y'], r5(m.wy));
                add(['max-luminance'], r5(m.maxL));
                add(['min-luminance'], r5(m.minL));
            }
        }

        if (sets.length === 0) {
            Logger.WLog('No container colour properties to write.');
            return false;
        }

        let e = Flow.Execute({ command: tool, argumentList: [file, '--edit', 'track:v1'].concat(sets) });
        // mkvpropedit: 0 = ok, 1 = ok with warnings, 2 = error
        if (e.exitCode === 0 || e.exitCode === 1) {
            Logger.ILog(`Container colour elements written (${sets.length / 2} properties).`);
            return true;
        }
        Logger.WLog(`mkvpropedit failed (exit ${e.exitCode}); container colour tags not written.`);
        return false;
    }

    // --- Dynamic Resolution Calculation ---
    let finalProbeRes = "";

    // 1. Check if user provided a manual resolution string (e.g., 1280x720)
    if (ProbeRes && ProbeRes.trim() !== "") {
        finalProbeRes = ProbeRes.trim();
        Logger.ILog(`Using manually specified ProbeRes: ${finalProbeRes}`);
    } 
    // 2. Otherwise, check if a target ProbeHeight was provided
    else if (ProbeHeight && ProbeHeight > 0) {
        
        let width = Variables['video.Width'];
        let height = Variables['video.Height'];

        if (height > ProbeHeight) {
            let aspectRatio = width / height;
            // Calculate width and ensure it is even (mod 2)
            let targetWidth = Math.round((ProbeHeight * aspectRatio) / 2) * 2;
            finalProbeRes = `${targetWidth}x${ProbeHeight}`;
            Logger.ILog(`Downscaling probes to ${ProbeHeight}p range: ${finalProbeRes}`);
        } else {
            Logger.ILog(`Source height (${height}) <= Target Height (${ProbeHeight}). Skipping downscale.`);
        }
        
    }

    // --- Argument Parsing ---
    let finalVideoParams = VideoParams || "";
    let colorInfo = null;          // source colour info (set for svt-av1 only)
    let colorTagsApplied = false;  // true if we injected any colour flags

    // --- SVT-AV1 Defaults: tune 3 (subjective SSIM) + quantization matrices ---
    // These are injected only for svt-av1 and only if the user hasn't already
    // specified the relevant flags in VideoParams or EncoderArgs.
    const resolvedEncoder = (Encoder || "svt-av1").trim().toLowerCase();
    if (resolvedEncoder === "svt-av1") {
        const allUserParams = [finalVideoParams, EncoderArgs || ""].join(" ");
        const svtDefaults = [
            { flag: "--tune",       value: "0"  },
            { flag: "--enable-qm",  value: "1"  },
            { flag: "--qm-min",     value: "0"  },
            { flag: "--qm-max",     value: "15" },
            { flag: "--pred-struct", value: "1" },
            { flag: "--lookahead",  value: "90" },
            {flag: "--enable-variance-boost", value: "1"}
        ];
        for (const { flag, value } of svtDefaults) {
            if (!allUserParams.includes(flag)) {
                finalVideoParams += (finalVideoParams ? " " : "") + `${flag} ${value}`;
                Logger.ILog(`SVT-AV1 default applied: ${flag} ${value}`);
            } else {
                Logger.ILog(`SVT-AV1 default skipped (user override detected): ${flag}`);
            }
        }

        // --- Colour tags / HDR metadata, mirrored from the source ---
        // av1an pipes raw frames to the encoder, so SVT only knows what we pass it here.
        // A failure in this block never fails the encode; it just logs a warning.
        try {
            colorInfo = probeColor(input);
            if (!colorInfo) {
                Logger.WLog('Could not read colour info from source; output will be untagged.');
            } else {
                Logger.ILog(`Source colour: primaries=${colorInfo.primaries || '?'} transfer=${colorInfo.transfer || '?'} matrix=${colorInfo.matrix || '?'} range=${colorInfo.range || '?'}`);

                let addParam = function (flag, value) {
                    let all = [finalVideoParams, EncoderArgs || ""].join(" ");
                    if (all.includes(flag)) {
                        Logger.ILog(`Colour param skipped (user override detected): ${flag}`);
                        return;
                    }
                    finalVideoParams += (finalVideoParams ? " " : "") + `${flag} ${value}`;
                    colorTagsApplied = true;
                    Logger.ILog(`Colour param applied: ${flag} ${value}`);
                };

                let isHdr = colorInfo.transfer === 'smpte2084' || colorInfo.transfer === 'arib-std-b67';

                let tagSpecs = [
                    { flag: '--color-primaries',          name: colorInfo.primaries, map: primariesMap },
                    { flag: '--transfer-characteristics', name: colorInfo.transfer,  map: transferMap },
                    { flag: '--matrix-coefficients',      name: colorInfo.matrix,    map: matrixMap }
                ];
                for (const spec of tagSpecs) {
                    if (spec.name && spec.map[spec.name] !== undefined) {
                        addParam(spec.flag, spec.map[spec.name]);
                    } else {
                        Logger.WLog(`No SVT mapping for ${spec.flag} value '${spec.name || 'unknown'}'; leaving it untagged.`);
                    }
                }

                if (colorInfo.range === 'tv') addParam('--color-range', 0);
                else if (colorInfo.range === 'pc') addParam('--color-range', 1);

                if (isHdr) {
                    if (colorInfo.mastering) {
                        let m = colorInfo.mastering;
                        let f4 = function (v) { return v.toFixed(4); };
                        // No spaces in the value, so no quoting is needed.
                        let mdStr = `G(${f4(m.gx)},${f4(m.gy)})B(${f4(m.bx)},${f4(m.by)})R(${f4(m.rx)},${f4(m.ry)})WP(${f4(m.wx)},${f4(m.wy)})L(${Number(m.maxL.toFixed(4))},${f4(m.minL)})`;
                        addParam('--mastering-display', mdStr);
                    } else {
                        Logger.WLog('HDR source has no mastering display metadata; not adding --mastering-display.');
                    }
                    if (colorInfo.cll && (colorInfo.cll.maxCll > 0 || colorInfo.cll.maxFall > 0)) {
                        addParam('--content-light', `${colorInfo.cll.maxCll},${colorInfo.cll.maxFall}`);
                    } else {
                        Logger.WLog('HDR source has no content light level metadata; not adding --content-light.');
                    }

                    let dynamic = colorInfo.sideTypes.filter(function (t) { return /dolby|dovi|2094-40/i.test(t); });
                    if (dynamic.length > 0) {
                        Logger.WLog(`Source has Dolby Vision / HDR10+ metadata (${dynamic.join(', ')}). It will be DROPPED; output will be plain HDR10.`);
                    }
                }
            }
        } catch (e) {
            Logger.WLog(`Colour/HDR detection failed: ${e}. Continuing without colour flags.`);
        }
    } else if (Variables['video.Width']) {
        Logger.WLog(`Colour/HDR flags are only injected for svt-av1; '${resolvedEncoder}' output may be untagged.`);
    }

    if (EncoderArgs) {
        let extraParams = EncoderArgs.split("|").join(" ");
        finalVideoParams += (finalVideoParams ? " " : "") + extraParams;
    }

    // --- Build Command ---
    let args = [
        "-i", input,
        "-o", output,
        "-e", Encoder || "svt-av1",
        "-m", "bestsource",
        "--target-quality", (TargetQuality || 80).toString(),
        "--target-metric", Metric || "ssimulacra2",
        "--temp", av1anTemp,
        "--probing-rate", 2,
        "-y",
        "-l", logLocation
    ];

    if (finalVideoParams) args.push("-v", finalVideoParams);
    if (MaxProbes) args.push("--probes", MaxProbes.toString());
    
    if (ProbeSlow === true) {
        args.push("--probe-video-params", "copy");
    } else if (ProbeParams) {
        args.push("--probe-video-params", ProbeParams);
    }
    
    if (Scaler) args.push("--scaler", Scaler);
    if (finalProbeRes) args.push("--probe-res", finalProbeRes);

    if (VspipeArgs) {
        let vArgs = VspipeArgs.split(",");
        vArgs.forEach(arg => args.push("--vspipe-args", arg.trim()));
    }

    // --- Execution ---
    Logger.ILog(`Command: ${av1an} ${args}`)
    let process = Flow.Execute({
        command: av1an,
        argumentList: args
    });

    if (process.exitCode !== 0) {
        Logger.ELog(`Av1an failed with exit code ${process.exitCode}`);
        return 2;
    }
    
    if (System.IO.File.Exists(logLocation)) {
        let logContent = System.IO.File.ReadAllText(logLocation);
            Logger.ILog(logContent);
        }

    // --- Post-encode verification (log only, never fails the flow) ---
    if (colorInfo && colorTagsApplied) {
        try {
            let out = probeColor(output);
            if (!out) {
                Logger.WLog('Could not probe the output to verify colour tags.');
            } else {
                let problems = 0;
                for (const k of ['primaries', 'transfer', 'matrix', 'range']) {
                    if (colorInfo[k] && colorInfo[k] !== out[k]) {
                        Logger.WLog(`Output ${k} is '${out[k] || 'unset'}' but source was '${colorInfo[k]}'.`);
                        problems++;
                    }
                }
                if (colorInfo.mastering && !out.mastering) {
                    Logger.WLog('Output has no mastering display metadata (source did).');
                    problems++;
                }
                if (colorInfo.cll && !out.cll) {
                    Logger.WLog('Output has no content light level metadata (source did).');
                    problems++;
                }
                if (problems === 0) {
                    Logger.ILog(`Output colour verified: ${out.primaries}/${out.transfer}/${out.matrix}/${out.range}, mastering=${!!out.mastering}, cll=${!!out.cll}`);
                }
            }
        } catch (e) {
            Logger.WLog(`Output colour verification failed: ${e}`);
        }
    }

    // --- Write container-level colour elements (never fails the flow) ---
    if (colorInfo && colorTagsApplied) {
        try {
            let outColor = probeColor(output);
            if (outColor) writeContainerColor(output, outColor);
            else Logger.WLog('Could not probe the output; container colour tags not written.');
        } catch (e) {
            Logger.WLog(`Writing container colour tags failed: ${e}`);
        }
    }

    Flow.SetWorkingFile(output);
    return 1;
}
