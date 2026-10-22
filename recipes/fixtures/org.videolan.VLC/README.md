# VLC smoke-test video

`smoke-test.mp4` is a five-second, 320×180, silent synthetic color/test-pattern
video generated from FFmpeg's `testsrc2` source and encoded as MPEG-4 Part 2.
The generated audiovisual work is dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). It contains no
third-party footage, audio, fonts, or other assets.

Recreate it with FFmpeg:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=320x180:rate=12' -t 5 -an \
  -c:v mpeg4 -q:v 8 -pix_fmt yuv420p -movflags +faststart smoke-test.mp4
```

The video is copied into the recipe's fresh application data profile before
VLC starts. It is deliberately short and silent: the screenshot recipe checks
that VLC opens media and displays video, not audio output, hardware acceleration,
or broad codec compatibility.
The recipe repeats this short clip so playback remains active during OCR and capture.
