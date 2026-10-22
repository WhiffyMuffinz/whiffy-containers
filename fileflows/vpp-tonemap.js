/**
 * @description Appends Intel QuickSync (QSV) VPP hardware tonemapping filters to HDR video
streams while preserving 10-bit (p010) output. Skips SDR files.
Run between "FFmpeg Builder: Start" and "FFmpeg Builder: Executor".
 * @output Applied filter
 * @output Not necessary
 */
function Script() {
    let ffmpegModel = Variables?.FfmpegBuilderModel;
    if (!ffmpegModel || !ffmpegModel.VideoStreams) {
        Logger.ELog('FFmpeg Builder Model or VideoStreams not found. Ensure this runs after "FFmpeg Builder: Start".');
        return -1;
    }

    let appliedFiltersCount = 0;

    for (let i = 0; i < ffmpegModel.VideoStreams.length; i++) {
        let video = ffmpegModel.VideoStreams[i];

        if (video.Deleted) continue;

        if (!video.Stream?.HDR) {
            Logger.ILog(`Video stream [${video.Index}] is already SDR — skipping.`);
            continue;
        }

        // --- FIX ---
        // video.Filters is null by default and re-assigning it from JS may not
        // marshal back to the C# model. Hardware filters (vpp_qsv) also need
        // to be emitted in the hardware context, which the Filters array does
        // not guarantee from a Function node.
        //
        // Instead, inject the -vf flag directly into EncodingParameters.
        // These are always initialised by the time we get here, are per-stream,
        // and compile verbatim into the FFmpeg command next to the codec args.
        if (!video.EncodingParameters) {
            video.EncodingParameters = [];
        }

        video.EncodingParameters.push('-vf');
        video.EncodingParameters.push('vpp_qsv=tonemap=1:format=p010');

        // Explicitly mark the stream as changed so the Executor doesn't skip it.
        video.ForcedChange = true;

        appliedFiltersCount++;
        Logger.ILog(`Applied VPP QSV tonemapping (10-bit p010) to HDR stream [${video.Index}]`);
    }

    if (appliedFiltersCount > 0) {
        Logger.ILog(`Done: tonemapping applied to ${appliedFiltersCount} stream(s).`);
        return 1; // → FFmpeg Builder: Executor
    } else {
        Logger.ILog('Done: file is already SDR, tonemapping not needed.');
        return 2; // → bypass / skip
    }
}
