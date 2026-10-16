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
    Flow.SetWorkingFile(output);
    return 1;
}
