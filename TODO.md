# SimpleClip - TODO

## High Priority
- [ ] Make FFmpeg the default export engine (WebCodecs has audio/video sync issues)
- [ ] Fix audio and video sync in exported files
- [ ] Improve Remove Silence: only create cuts for silences longer than 3 seconds, and add 0.5s margin before each cut starts

## Future
- [ ] WebCodecs: fix sync issues so it can replace FFmpeg as default
- [ ] Benchmark: compare export approaches with real videos
- [ ] Multi-segment FFmpeg export: too slow for long videos, needs optimization
