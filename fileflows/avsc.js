/**
 * @description Automatically generates chapters by analyzing the video for scene changes using av-scenechange, and adds them to the FFmpeg Builder model (same mechanism as the built-in Auto Chapters node). Pipes via ffmpeg (yuv4mpegpipe) and downscales >1080p sources to 720p with lanczos for faster detection. Requires a "av-scenechange" Tool to be configured in FileFlows (Settings > Tools) pointing to the av-scenechange binary. Must be used inside an FFmpeg Builder flow, after "FFmpeg Builder: Start".
 * @param {string} ChapterNames Optional override for chapter names. Use {index} to insert the chapter number. e.g. "Chapter {index}"
 * @param {int} MinimumLength The minimum length of a chapter in seconds
 * @param {('0'|'1')} Speed Speed level for scene-change detection, 0: best quality, 1: fastest mode
 * @param {bool} NoFlashDetection Do not detect short scene flashes and exclude them as scene cuts
 * @param {int} MinSceneCut Sets a minimum interval (in frames) between two consecutive scenecuts. 0 = not set
 * @param {int} MaxSceneCut Sets a maximum interval (in frames) between two consecutive scenecuts, after which a scenecut will be forced. 0 = not set
 * @param {bool} ReplaceExisting Whether existing chapters should be replaced. If disabled and chapters already exist, no new chapters will be added
 * @param {bool} UseHwaccel Enable ffmpeg hardware-accelerated decoding via '-hwaccel auto' before the input. Disable if you hit hwdownload/scale filter errors.
 * @output Chapters were detected and added to the FFmpeg Builder
 * @output No chapters were detected or the video already contained chapters
 */
function Script(ChapterNames, MinimumLength, Speed, NoFlashDetection, MinSceneCut, MaxSceneCut, ReplaceExisting, UseHwaccel)
{
    let model = Variables.FfmpegBuilderModel;
    if (!model)
    {
        Logger.ELog('No FfmpegBuilderModel found, this script must be used inside a FFmpeg Builder flow');
        return -1;
    }

    let chapterNameFormat = ('' + (ChapterNames || '')).trim();
    if (!chapterNameFormat)
        chapterNameFormat = 'Chapter {index}';

    let minLengthSeconds = parseInt('' + MinimumLength, 10);
    if (!minLengthSeconds || minLengthSeconds < 0)
        minLengthSeconds = 60;
    let minLengthMs = minLengthSeconds * 1000;

    // Check for existing chapters
    let existingChapters = model.VideoInfo && model.VideoInfo.Chapters ? model.VideoInfo.Chapters : [];
    if (existingChapters.length > 0 && !ReplaceExisting)
    {
        Logger.ILog('Video already has ' + existingChapters.length + ' chapter(s) and Replace Existing is disabled');
        return 2;
    }

    // Need fps + duration from the video stream to convert frame numbers to timestamps
    let videoStream = model.VideoInfo && model.VideoInfo.VideoStreams && model.VideoInfo.VideoStreams.length > 0
        ? model.VideoInfo.VideoStreams[0] : null;
    if (!videoStream)
    {
        Logger.ELog('No video stream found, cannot calculate chapter timestamps');
        return -1;
    }

    let fps = videoStream.FramesPerSecond;
    let durationSeconds = videoStream.Duration;
    if (!fps || fps <= 0)
    {
        Logger.ELog('Could not determine frame rate of video');
        return -1;
    }
    if (!durationSeconds || durationSeconds <= 0)
    {
        Logger.ELog('Could not determine duration of video');
        return -1;
    }
    let totalDurationMs = Math.round(durationSeconds * 1000);

    let inputFile = Flow.WorkingFile;
    let workDir = Flow.TempPath + '/av-scenechange-' + Flow.NewGuid();
    Flow.CreateDirectoryIfNotExists(workDir);
    let outputJson = workDir + '/scenechange.json';

    // Tool lookup: prefer FileFlows Tools, fall back to well-known paths / PATH.
    function getToolPath(name, fallback)
    {
        try { if (typeof Flow.GetToolPath === 'function') { let p = Flow.GetToolPath(name); if (p) return p; } } catch (e) {}
        try { if (typeof Flow.GetToolExecutablePath === 'function') { let p = Flow.GetToolExecutablePath(name); if (p) return p; } } catch (e) {}
        return fallback;
    }
    let ffmpeg = getToolPath('ffmpeg', 'ffmpeg');
    let avScenechange = getToolPath('av-scenechange', '/usr/local/bin/av-scenechange');
    if (!avScenechange)
    {
        Logger.ELog('av-scenechange tool not configured. Add it under Settings > Tools.');
        return -1;
    }

    // Downscale rule: height > 1080 -> 720p. Width ignored (covers ultra-wide).
    let srcW = videoStream.Width || videoStream.width || 0;
    let srcH = videoStream.Height || videoStream.height || 0;
    let needsScale = srcH > 1080;
    Logger.ILog('Source resolution: ' + srcW + 'x' + srcH + ' -> ' + (needsScale ? 'downscaling to 720p (scale=-2:720:flags=lanczos)' : 'no scaling'));

    // Toggle: ffmpeg -hwaccel auto -i ... (must precede -i)
    let hwaccelOn = (UseHwaccel === true || UseHwaccel === 1 || UseHwaccel === '1' || ('' + UseHwaccel).toLowerCase() === 'true');
    Logger.ILog('HWAccel: ' + (hwaccelOn ? 'enabled (-hwaccel auto)' : 'disabled'));

    // av-scenechange args (stdin '-', stdout redirected to file — same fix as before
    // so FileFlows never has to buffer large JSON in memory).
    let scArgs = [ '-s', '' + Speed ];
    if (NoFlashDetection)
        scArgs.push('--no-flash-detection');
    let minScenecut = parseInt('' + MinSceneCut, 10);
    if (minScenecut > 0)
        scArgs.push('--min-scenecut', '' + minScenecut);
    let maxScenecut = parseInt('' + MaxSceneCut, 10);
    if (maxScenecut > 0)
        scArgs.push('--max-scenecut', '' + maxScenecut);
    scArgs.push('-'); // stdin (yuv4mpegpipe)

    // ffmpeg args: decode (+ optional hwaccel/scale) -> yuv4mpegpipe on stdout.
    // -pix_fmt yuv420p keeps the pipe 8-bit/fast; 10-bit sources are detected in 8-bit (fine for cuts).
    let ffArgs = [ '-hide_banner', '-loglevel', 'error' ];
    if (hwaccelOn)
        ffArgs.push('-hwaccel', 'auto');
    ffArgs.push('-i', inputFile);
    if (needsScale)
        ffArgs.push('-vf', 'scale=-2:720:flags=lanczos');
    ffArgs.push('-pix_fmt', 'yuv420p', '-f', 'yuv4mpegpipe', '-');

    // Simple POSIX-shell quoting so paths/args with spaces or special characters
    // survive being passed through `bash -c`.
    function shellQuote(value)
    {
        return "'" + ('' + value).replace(/'/g, "'\\''") + "'";
    }

    let shellCommand = shellQuote(ffmpeg) + ' ' +
        ffArgs.map(shellQuote).join(' ') +
        ' | ' + shellQuote(avScenechange) + ' ' +
        scArgs.map(shellQuote).join(' ') +
        ' > ' + shellQuote(outputJson);

    Logger.ILog('Running ffmpeg | av-scenechange via shell redirection: ' + shellCommand);

    let process = Flow.Execute({
        command: '/bin/bash',
        argumentList: [ '-c', shellCommand ]
    });

    Logger.ILog('pipeline exit code: ' + process.exitCode);
    if (process.standardOutput)
        Logger.ILog('pipeline output: ' + process.standardOutput);
    if (process.standardError)
        Logger.ILog('pipeline stderr: ' + process.standardError);

    if (process.exitCode !== 0)
    {
        Logger.ELog('ffmpeg|av-scenechange pipeline failed with exit code: ' + process.exitCode);
        if (hwaccelOn)
            Logger.ELog('Hint: retry with UseHwaccel off — some builds need hwdownload before the software scale filter.');
        return -1;
    }

    if (System.IO.File.Exists(outputJson) === false)
    {
        Logger.ELog('av-scenechange did not produce an output file');
        return -1;
    }

    let jsonText = System.IO.File.ReadAllText(outputJson);
    let result;
    try
    {
        result = JSON.parse(jsonText);
    }
    catch (err)
    {
        Logger.ELog('Failed to parse av-scenechange output: ' + err);
        return -1;
    }

    let sceneChanges = result.scene_changes || [];
    if (sceneChanges.length === 0)
    {
        Logger.ILog('No scene changes detected');
        return 2;
    }

    // sort and convert frame numbers -> ms, ensure 0 is the first chapter start
    sceneChanges = sceneChanges.slice().sort(function (a, b) { return a - b; });

    let starts = [];
    let lastStartMs = -minLengthMs - 1; // ensure first point is always accepted
    for (let i = 0; i < sceneChanges.length; i++)
    {
        let frame = sceneChanges[i];
        let ms = Math.round((frame / fps) * 1000);
        if (ms < 0)
            ms = 0;
        if (ms >= totalDurationMs)
            continue;

        if (starts.length === 0)
        {
            // always force the first chapter to start at 0
            starts.push(0);
            lastStartMs = 0;
            if (ms === 0)
                continue;
            // if first detected scene change isn't 0, still evaluate it normally below
        }

        if (ms - lastStartMs < minLengthMs)
            continue;

        starts.push(ms);
        lastStartMs = ms;
    }

    if (starts.length === 0)
        starts.push(0);

    if (starts.length < 2)
    {
        Logger.ILog('Not enough valid scene changes to create chapters (after Minimum Length filtering)');
        return 2;
    }

    // Build ffmetadata chapters file
    let lines = [ ';FFMETADATA1' ];
    for (let i = 0; i < starts.length; i++)
    {
        let start = starts[i];
        let end = (i + 1 < starts.length) ? starts[i + 1] : totalDurationMs;
        let title = chapterNameFormat.replace('{index}', '' + (i + 1));

        lines.push('[CHAPTER]');
        lines.push('TIMEBASE=1/1000');
        lines.push('START=' + start);
        lines.push('END=' + end);
        lines.push('title=' + title);
    }

    let metadataContent = lines.join('\n') + '\n';
    let metadataFile = workDir + '/chapters.txt';
    System.IO.File.WriteAllText(metadataFile, metadataContent);

    Logger.ILog('Minimum length of chapter ' + minLengthSeconds + ' seconds');
    Logger.ILog('Chapter Name Format: ' + chapterNameFormat);
    Logger.ILog('Auto Chapters File:');
    Logger.ILog(metadataContent);

    if (!model.CustomParameters)
        model.CustomParameters = [];

    let inputIndex = model.InputFiles ? model.InputFiles.length : 0;
    model.CustomParameters.push('-i', metadataFile, '-map_chapters', '' + inputIndex);

    Logger.ILog('Added ' + starts.length + ' chapter(s) to the FFmpeg Builder ');

    return 1;
}
