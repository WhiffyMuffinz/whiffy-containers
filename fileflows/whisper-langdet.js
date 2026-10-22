/**
 * @description Detects the spoken language of every audio track using whisper-cli (language detection only, no transcription). For each track, N short samples are cut from the middle of the media (skipping intros/credits), each is run through whisper's language detector, and the results are combined with a confidence-weighted vote. The winning language is written to the FFmpeg Builder model as an ISO 639-2/T code (eng, fra, deu...). Silent samples are skipped. Must be used inside an FFmpeg Builder flow, after "FFmpeg Builder: Start" and before the Executor.
 * @param {string} WhisperCli Optional path to the whisper-cli binary. Blank = use a "whisper-cli" Tool if configured, else "whisper-cli" from PATH
 * @param {string} ModelPath Path to the whisper ggml model. Blank = /opt/whisper/models/ggml-medium-q8_0.bin
 * @param {int} SampleCount Max samples per track (default 5)
 * @param {int} SampleSeconds Length of each sample in seconds (default 30, whisper only looks at the first 30s anyway)
 * @param {int} SkipEdgePercent Percent of the duration to skip at the start and end when sampling (default 20, max 45)
 * @param {int} MinConfidence Minimum confidence (0-100) required to apply a result. Confidence = winning weighted votes / usable samples. 0 = always apply
 * @param {int} SilenceThresholdDb Samples with a mean volume below this (dB) are skipped as silent. 0 = default of -55
 * @param {int} Threads Threads for whisper-cli (-t). 0 = whisper default
 * @param {bool} OnlyUndefined Only process tracks with a blank/und language. If off, every audio track is checked and overwritten
 * @output Language was detected and updated for one or more audio tracks
 * @output No tracks were updated (nothing qualified, detection failed, or confidence was too low)
 */
function Script(WhisperCli, ModelPath, SampleCount, SampleSeconds, SkipEdgePercent, MinConfidence, SilenceThresholdDb, Threads, OnlyUndefined)
{
    let model = Variables.FfmpegBuilderModel;
    if (!model)
    {
        Logger.ELog('No FfmpegBuilderModel found, this script must be used inside a FFmpeg Builder flow');
        return -1;
    }
    if (!model.AudioStreams || model.AudioStreams.length === 0)
    {
        Logger.ILog('No audio streams in the model');
        return 2;
    }

    // ---------- parameters / defaults ----------
    function intOr(value, fallback)
    {
        let n = parseInt('' + value, 10);
        return (isNaN(n) || n === 0) ? fallback : n;
    }
    let sampleCount = Math.max(1, intOr(SampleCount, 5));
    let sampleSeconds = Math.max(5, intOr(SampleSeconds, 30));
    let edgePct = Math.min(45, Math.max(0, intOr(SkipEdgePercent, 20)));
    let silenceDb = intOr(SilenceThresholdDb, -55);
    let minConfidence = parseInt('' + MinConfidence, 10);
    if (isNaN(minConfidence) || minConfidence < 0) minConfidence = 0;
    let threads = parseInt('' + Threads, 10);
    if (isNaN(threads) || threads < 0) threads = 0;
    let onlyUndefined = (OnlyUndefined === true || ('' + OnlyUndefined).toLowerCase() === 'true');

    let modelPath = ('' + (ModelPath || '')).trim();
    if (!modelPath) modelPath = '/opt/whisper/models/ggml-medium-q8_0.bin';
    if (!System.IO.File.Exists(modelPath))
    {
        Logger.ELog('Whisper model not found: ' + modelPath);
        return -1;
    }

    function getToolPath(name, fallback)
    {
        try { if (typeof Flow.GetToolPath === 'function') { let p = Flow.GetToolPath(name); if (p) return p; } } catch (e) {}
        try { if (typeof Flow.GetToolExecutablePath === 'function') { let p = Flow.GetToolExecutablePath(name); if (p) return p; } } catch (e) {}
        return fallback;
    }
    let ffmpeg = getToolPath('ffmpeg', 'ffmpeg');
    let ffprobe = getToolPath('ffprobe', 'ffprobe');
    let whisper = ('' + (WhisperCli || '')).trim();
    if (!whisper) whisper = getToolPath('whisper-cli', 'whisper-cli');

    // ---------- whisper (ISO 639-1) -> ISO 639-2/T ----------
    let LANG = {
        en:'eng', zh:'zho', de:'deu', es:'spa', ru:'rus', ko:'kor', fr:'fra', ja:'jpn', pt:'por', tr:'tur',
        pl:'pol', ca:'cat', nl:'nld', ar:'ara', sv:'swe', it:'ita', id:'ind', hi:'hin', fi:'fin', vi:'vie',
        he:'heb', uk:'ukr', el:'ell', ms:'msa', cs:'ces', ro:'ron', da:'dan', hu:'hun', ta:'tam', no:'nor',
        th:'tha', ur:'urd', hr:'hrv', bg:'bul', lt:'lit', la:'lat', mi:'mri', ml:'mal', cy:'cym', sk:'slk',
        te:'tel', fa:'fas', lv:'lav', bn:'ben', sr:'srp', az:'aze', sl:'slv', kn:'kan', et:'est', mk:'mkd',
        br:'bre', eu:'eus', is:'isl', hy:'hye', ne:'nep', mn:'mon', bs:'bos', kk:'kaz', sq:'sqi', sw:'swa',
        gl:'glg', mr:'mar', pa:'pan', si:'sin', km:'khm', sn:'sna', yo:'yor', so:'som', af:'afr', oc:'oci',
        ka:'kat', be:'bel', tg:'tgk', sd:'snd', gu:'guj', am:'amh', yi:'yid', lo:'lao', uz:'uzb', fo:'fao',
        ht:'hat', ps:'pus', tk:'tuk', nn:'nno', mt:'mlt', sa:'san', lb:'ltz', my:'mya', bo:'bod', tl:'tgl',
        mg:'mlg', as:'asm', tt:'tat', haw:'haw', ln:'lin', ha:'hau', ba:'bak', jw:'jav', su:'sun', yue:'yue'
    };

    // ---------- helpers ----------
    function combinedOutput(proc)
    {
        return ('' + (proc.standardOutput || '')) + '\n' + ('' + (proc.standardError || ''));
    }

    function safeDelete(path)
    {
        try { if (System.IO.File.Exists(path)) System.IO.File.Delete(path); } catch (e) {}
    }

    // Coerce whatever FileFlows hands back (number, numeric string, "hh:mm:ss", TimeSpan) into seconds. 0 = unknown.
    function toSeconds(v)
    {
        if (v === undefined || v === null) return 0;
        if (typeof v === 'number') return (isFinite(v) && v > 0) ? v : 0;
        try
        {
            if (v.TotalSeconds !== undefined)
            {
                let ts = Number(v.TotalSeconds);
                if (isFinite(ts) && ts > 0) return ts;
            }
        }
        catch (e) {}
        let s = ('' + v).trim();
        let m = /^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s);   // [d.]hh:mm:ss[.fff]
        if (m)
            return (m[1] ? parseInt(m[1], 10) * 86400 : 0) + parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60 + parseFloat(m[4]);
        let n = parseFloat(s);
        return (isFinite(n) && n > 0) ? n : 0;
    }

    // Last resort: ask ffprobe for the container duration (cached).
    let probedDuration = null;
    function probeDuration(file)
    {
        if (probedDuration !== null) return probedDuration;
        probedDuration = 0;
        try
        {
            let proc = Flow.Execute({ command: ffprobe, argumentList: [ '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file ] });
            if (proc.exitCode === 0)
                probedDuration = toSeconds(('' + (proc.standardOutput || '')).trim().split('\n')[0]);
        }
        catch (e) { Logger.WLog('ffprobe duration lookup failed: ' + e); }
        return probedDuration;
    }

    // Evenly spaced sample start offsets (seconds) across the middle of the media.
    function planSamples(duration)
    {
        if (!isFinite(duration) || duration <= sampleSeconds)
            return [0];

        let start = duration * edgePct / 100;
        let end = duration - start;
        let region = end - start;
        if (region < sampleSeconds)
        {
            start = 0;
            end = duration;
            region = duration;
        }

        let n = Math.min(sampleCount, Math.max(1, Math.floor(region / sampleSeconds)));
        if (!isFinite(n) || n < 1) return [0];
        let slot = region / n;
        let offsets = [];
        for (let i = 0; i < n; i++)
        {
            let ss = start + slot * (i + 0.5) - sampleSeconds / 2;
            if (ss > duration - sampleSeconds) ss = duration - sampleSeconds;
            if (ss < 0) ss = 0;
            offsets.push(ss);
        }
        return offsets;
    }

    // Extract one 16 kHz mono wav sample. Returns mean volume in dB (or null if unknown), -1000 on failure.
    function extractSample(inputFile, streamIndex, ss, wavPath)
    {
        let args = [ '-hide_banner', '-nostats', '-loglevel', 'info', '-y',
            '-ss', ss.toFixed(2), '-t', '' + sampleSeconds,
            '-i', inputFile,
            '-map', '0:' + streamIndex,
            '-vn', '-sn', '-dn',
            '-af', 'volumedetect',
            '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
            wavPath ];
        let proc = Flow.Execute({ command: ffmpeg, argumentList: args });
        if (proc.exitCode !== 0 || !System.IO.File.Exists(wavPath))
        {
            Logger.WLog('ffmpeg sample extraction failed (exit ' + proc.exitCode + ') at ' + ss.toFixed(0) + 's: ' + ('' + (proc.standardError || '')).slice(-300));
            return -1000;
        }
        let m = /mean_volume:\s*(-?[0-9.]+|-inf)\s*dB/i.exec(combinedOutput(proc));
        if (!m) return null;
        if (m[1] === '-inf') return -200;
        return parseFloat(m[1]);
    }

    // Run whisper-cli language detection on a wav. Returns { lang, p } or null.
    function detectLanguage(wavPath)
    {
        let args = [ '-m', modelPath, '-f', wavPath, '-dl' ];
        if (threads > 0) args.push('-t', '' + threads);
        let proc = Flow.Execute({ command: whisper, argumentList: args });
        let text = combinedOutput(proc);
        let m = /auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([0-9.]+)\)/i.exec(text);
        if (!m)
        {
            Logger.WLog('whisper-cli gave no language result (exit ' + proc.exitCode + '): ' + text.slice(-400));
            return null;
        }
        return { lang: m[1].toLowerCase(), p: parseFloat(m[2]) };
    }

    // ---------- main loop ----------
    let inputFile = Flow.WorkingFile;
    let workDir = Flow.TempPath + '/whisper-lang-' + Flow.NewGuid();
    Flow.CreateDirectoryIfNotExists(workDir);

    let videoDuration = 0;
    if (model.VideoInfo && model.VideoInfo.VideoStreams && model.VideoInfo.VideoStreams.length > 0)
        videoDuration = toSeconds(model.VideoInfo.VideoStreams[0].Duration);

    let updated = 0;

    for (let t = 0; t < model.AudioStreams.length; t++)
    {
        let track = model.AudioStreams[t];
        if (track.Deleted)
            continue;

        let src = track.Stream;
        let streamIndex = (src && src.Index !== undefined && src.Index !== null) ? src.Index : track.Index;
        let inputIdx = (src && src.InputFileIndex) ? src.InputFileIndex : 0;
        let label = 'Audio #' + t + ' (stream 0:' + streamIndex + ')';

        if (inputIdx !== 0)
        {
            Logger.ILog(label + ': belongs to an additional input file, skipping');
            continue;
        }

        let existing = track.Language ? ('' + track.Language).toLowerCase().trim() : '';
        let isUndefined = (existing === '' || existing === 'und' || existing === 'unk' || existing === 'unknown');
        if (onlyUndefined && !isUndefined)
        {
            Logger.ILog(label + ': language already set to "' + existing + '", skipping');
            continue;
        }

        let rawDuration = src ? src.Duration : undefined;
        let duration = toSeconds(rawDuration);
        let durationSource = 'audio stream';
        if (duration <= 0)
        {
            duration = videoDuration;
            durationSource = 'video stream';
        }
        if (duration <= 0)
        {
            duration = probeDuration(inputFile);
            durationSource = 'ffprobe';
        }
        if (duration <= 0)
        {
            Logger.WLog(label + ': could not determine duration (raw audio Duration: ' + typeof rawDuration + ' "' + rawDuration + '"), sampling from the start only');
            durationSource = 'unknown';
        }

        let offsets = planSamples(duration);
        if (offsets.length === 0)
            offsets = [0];
        Logger.ILog(label + ': existing language "' + (existing || 'none') + '", duration ' + Math.round(duration) + 's (' + durationSource + '), ' + offsets.length + ' sample(s) of ' + sampleSeconds + 's');

        let scores = {};
        let usable = 0;

        for (let s = 0; s < offsets.length; s++)
        {
            let wav = workDir + '/a' + t + '_s' + s + '.wav';
            try
            {
                let vol = extractSample(inputFile, streamIndex, offsets[s], wav);
                if (vol === -1000)
                    continue;
                if (vol !== null && vol < silenceDb)
                {
                    Logger.ILog('  sample ' + (s + 1) + ' @' + offsets[s].toFixed(0) + 's: silent (' + vol + ' dB), skipped');
                    continue;
                }

                let res = detectLanguage(wav);
                if (!res)
                    continue;

                Logger.ILog('  sample ' + (s + 1) + ' @' + offsets[s].toFixed(0) + 's: ' + res.lang + ' (p=' + res.p.toFixed(3) + ')');
                scores[res.lang] = (scores[res.lang] || 0) + res.p;
                usable++;
            }
            catch (err)
            {
                Logger.WLog('  sample ' + (s + 1) + ' failed: ' + err);
            }
            finally
            {
                safeDelete(wav);
            }
        }

        if (usable === 0)
        {
            Logger.WLog(label + ': no usable samples, leaving language unchanged');
            continue;
        }

        let winner = null;
        let tally = [];
        for (let lang in scores)
        {
            tally.push(lang + '=' + scores[lang].toFixed(2));
            if (winner === null || scores[lang] > scores[winner])
                winner = lang;
        }
        let confidence = scores[winner] / usable;   // 0..1
        Logger.ILog(label + ': weighted votes [' + tally.join(', ') + '] over ' + usable + ' sample(s) -> ' + winner + ' (confidence ' + Math.round(confidence * 100) + '%)');

        if (confidence * 100 < minConfidence)
        {
            Logger.WLog(label + ': confidence below ' + minConfidence + '%, leaving language unchanged');
            continue;
        }

        let code = LANG[winner];
        if (!code)
        {
            Logger.WLog(label + ': no ISO 639-2 mapping for whisper code "' + winner + '", leaving language unchanged');
            continue;
        }

        if (existing !== code)
        {
            Logger.ILog(label + ': language "' + (existing || 'none') + '" -> "' + code + '"');
            track.Language = code;
            track.ForcedChange = true;
            updated++;
        }
        else
        {
            Logger.ILog(label + ': language already "' + code + '"');
        }
    }

    try { System.IO.Directory.Delete(workDir, true); } catch (e) {}

    if (updated === 0)
    {
        Logger.ILog('No audio track languages were changed');
        return 2;
    }

    Logger.ILog('Updated language on ' + updated + ' audio track(s) in the FFmpeg Builder model');
    return 1;
}
