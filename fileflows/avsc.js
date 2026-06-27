/**
 * Automatically generates chapters by analyzing the video for scene changes using av-scenechange,
 * and adds them to the FFmpeg Builder model (same mechanism as the built-in Auto Chapters node).
 *
 * Requires a "av-scenechange" Tool to be configured in FileFlows (Settings > Tools) pointing to
 * the av-scenechange binary.
 *
 * Must be used inside an FFmpeg Builder flow, after "FFmpeg Builder: Start".
 *
 * @author ClaudeAI
 * @version 1.0.0
 * @help Detects scene changes using av-scenechange and adds them as chapters to the FFmpeg Builder.
 * @param {string} ChapterNames Optional override for chapter names. Use {index} to insert the chapter number. e.g. "Chapter {index}"
 * @param {int} MinimumLength The minimum length of a chapter in seconds
 * @param {('0'|'1')} Speed Speed level for scene-change detection, 0: best quality, 1: fastest mode
 * @param {bool} NoFlashDetection Do not detect short scene flashes and exclude them as scene cuts
 * @param {int} MinSceneCut Sets a minimum interval (in frames) between two consecutive scenecuts. 0 = not set
 * @param {int} MaxSceneCut Sets a maximum interval (in frames) between two consecutive scenecuts, after which a scenecut will be forced. 0 = not set
 * @param {bool} ReplaceExisting Whether existing chapters should be replaced. If disabled and chapters already exist, no new chapters will be added
 * @output Chapters were detected and added to the FFmpeg Builder
 * @output No chapters were detected or the video already contained chapters
 */
function Script(ChapterNames, MinimumLength, Speed, NoFlashDetection, MinSceneCut, MaxSceneCut, ReplaceExisting)
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
    let avScenechange = Flow.GetToolPath('av-scenechange');
    if (!avScenechange)
    {
        Logger.ELog('av-scenechange tool not configured. Add it under Settings > Tools.');
        return -1;
    }

    let args = [ '-o', outputJson, '-s', '' + Speed ];
    if (NoFlashDetection)
        args.push('--no-flash-detection');
    let minScenecut = parseInt('' + MinSceneCut, 10);
    if (minScenecut > 0)
        args.push('--min-scenecut', '' + minScenecut);
    let maxScenecut = parseInt('' + MaxSceneCut, 10);
    if (maxScenecut > 0)
        args.push('--max-scenecut', '' + maxScenecut);
    args.push(inputFile);

    Logger.ILog('Running av-scenechange: ' + avScenechange + ' ' + args.join(' '));

    let process = Flow.Execute({
        command: avScenechange,
        argumentList: args
    });

    Logger.ILog('av-scenechange exit code: ' + process.exitCode);
    if (process.standardOutput)
        Logger.ILog('av-scenechange output: ' + process.standardOutput);
    if (process.standardError)
        Logger.ILog('av-scenechange stderr: ' + process.standardError);

    if (process.exitCode !== 0)
    {
        Logger.ELog('av-scenechange failed with exit code: ' + process.exitCode);
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

    if (!model.InputFiles)
        model.InputFiles = [];
    if (!model.CustomParameters)
        model.CustomParameters = [];

    model.InputFiles.push(metadataFile);
    let inputIndex = model.InputFiles.length - 1;
    model.CustomParameters.push('-map_chapters');
    model.CustomParameters.push('' + inputIndex);

    Logger.ILog('Added ' + starts.length + ' chapter(s) to the FFmpeg Builder using input index ' + inputIndex);

    return 1;
}
