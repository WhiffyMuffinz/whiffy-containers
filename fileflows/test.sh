#!/bin/bash
set -uo pipefail

PASS=0
FAIL=0
SKIP=0
WORKDIR="/tmp/smoke-tests-$$"
mkdir -p "$WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

pass() {
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}✓${RESET} $1"
}
fail() {
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}✗${RESET} $1: $2"
}
skip() {
  SKIP=$((SKIP + 1))
  echo -e "  ${YELLOW}⊘${RESET} $1: $2"
}

check_binary() {
  local name="$1" path="$2"
  if [ -f "$path" ]; then
    pass "$name found at $path"
  else
    fail "$name" "not found at $path"
  fi
}

check_lib() {
  local name="$1" path="$2"
  if [ -f "$path" ]; then
    pass "$name present"
  else
    fail "$name" "not found at $path"
  fi
}

check_version() {
  local name="$1"
  shift
  local output
  if output=$("$@" 2>&1); then
    if [ -n "$output" ]; then
      pass "$name version check OK"
    else
      fail "$name" "empty output"
    fi
  else
    fail "$name" "exit code $?"
  fi
}

check_functional() {
  local name="$1" file="$2" min_size="${3:-100}"
  if [ -f "$file" ]; then
    local size
    size=$(stat -c%s "$file" 2>/dev/null || echo 0)
    if [ "$size" -ge "$min_size" ]; then
      pass "$name (${size} bytes)"
    else
      fail "$name" "file too small (${size} bytes)"
    fi
  else
    fail "$name" "output file not created"
  fi
}

# ============================================================================
echo -e "\n${BOLD}=== FileFlows Smoke Tests ===${RESET}\n"

# --- Generate test video ---
echo -e "${BOLD}[Setup]${RESET} Generating test video..."
ffmpeg -v error -f lavfi -i "testsrc=duration=2:size=640x360:rate=24" \
  -f lavfi -i "sine=frequency=1000:duration=2" \
  -c:v libx264 -preset ultrafast -c:a aac -y "$WORKDIR/test.mp4"

if [ ! -f "$WORKDIR/test.mp4" ]; then
  echo -e "${RED}FATAL: Could not generate test video${RESET}"
  exit 1
fi
pass "Test video generated"

# ============================================================================
echo -e "\n${BOLD}[Binaries]${RESET}"
check_binary "ffmpeg (Jellyfin)" "/usr/local/bin/ffmpeg"
check_binary "ffprobe" "/usr/local/bin/ffprobe"
check_binary "ffmpeg-static (BtbN)" "/opt/ffmpeg-static/bin/ffmpeg"
check_binary "ab-av1" "/usr/local/bin/ab-av1"
check_binary "SvtAv1EncApp" "/usr/local/bin/SvtAv1EncApp"
check_binary "av1an" "/usr/local/bin/av1an"
check_binary "vspipe" "/usr/local/bin/vspipe"
check_binary "dotnet" "/dotnet/dotnet"

# ============================================================================
echo -e "\n${BOLD}[Libraries]${RESET}"
check_lib "libvapoursynth.so" "/usr/local/lib/libvapoursynth.so"
check_lib "libzimg.so" "/usr/local/lib/libzimg.so"
check_lib "libbestsource.so" "/usr/local/lib/vapoursynth/bestsource.so"
check_lib "libvszip.so (SSIM2)" "/usr/local/lib/vapoursynth/libvszip.so"

if ls /usr/local/lib/vapoursynth/*vship*.so >/dev/null 2>&1; then
  pass "Vship plugins present"
else
  fail "Vship plugins" "no *vship*.so found in /usr/local/lib/vapoursynth/"
fi

# ============================================================================
echo -e "\n${BOLD}[Versions]${RESET}"
check_version "ffmpeg" ffmpeg -version
check_version "ffmpeg-static" /opt/ffmpeg-static/bin/ffmpeg -version
check_version "SvtAv1EncApp" SvtAv1EncApp --help
check_version "av1an" av1an --version
check_version "vspipe" vspipe --version

# ============================================================================
echo -e "\n${BOLD}[VapourSynth]${RESET}"
if python3 -c "import vapoursynth" 2>/dev/null; then
  pass "VapourSynth Python import OK"
else
  fail "VapourSynth Python import" "failed"
fi

# ============================================================================
echo -e "\n${BOLD}[Functional]${RESET}"

# ffmpeg h264 encode
ffmpeg -v error -i "$WORKDIR/test.mp4" -c:v libx264 -preset ultrafast -t 1 -y "$WORKDIR/out_h264.mp4"
check_functional "ffmpeg h264 encode" "$WORKDIR/out_h264.mp4"

# ffmpeg-static encode
/opt/ffmpeg-static/bin/ffmpeg -v error -i "$WORKDIR/test.mp4" -c:v libx264 -preset ultrafast -t 1 -y "$WORKDIR/out_btbn.mp4"
check_functional "ffmpeg-static encode" "$WORKDIR/out_btbn.mp4"

# SVT-AV1 raw encode (Y4M pipe)
ffmpeg -v error -i "$WORKDIR/test.mp4" -t 1 -f yuv4mpegpipe -pix_fmt yuv420p - |
  SvtAv1EncApp -i stdin -b "$WORKDIR/out_svt.ivf" -n 24 --preset 12 2>/dev/null
check_functional "SVT-AV1 raw encode" "$WORKDIR/out_svt.ivf"

# ab-av1 encode
if /app/common/ab-av1/ab-av1 encode -i "$WORKDIR/test.mp4" -o "$WORKDIR/out_abav1.mp4" --crf 30 2>/dev/null; then
  check_functional "ab-av1 encode" "$WORKDIR/out_abav1.mp4"
else
  fail "ab-av1" "encode failed"
fi

# VapourSynth + vspipe test
cat >"$WORKDIR/test.vpy" <<'VPY'
import vapoursynth as vs
core = vs.core
clip = core.ffms2.Source(r"%%INPUT%%")
clip.set_output()
VPY
sed -i "s|%%INPUT%%|$WORKDIR/test.mp4|" "$WORKDIR/test.vpy"

if vspipe -c y4m "$WORKDIR/test.vpy" "$WORKDIR/out_vpy.y4m" 2>/dev/null; then
  check_functional "VapourSynth + vspipe pipeline" "$WORKDIR/out_vpy.y4m" 1000
else
  fail "VapourSynth + vspipe pipeline" "vspipe failed"
fi

# av1an encode
av1an -i "$WORKDIR/test.mp4" -e svt-av1 -o "$WORKDIR/out_av1an.mkv" \
  --force --keep --temp "$WORKDIR/av1an-temp" 2>/dev/null
check_functional "av1an encode" "$WORKDIR/out_av1an.mkv"

# ============================================================================
echo -e "\n${BOLD}[Runtime]${RESET}"

dotnet_ver=$(/dotnet/dotnet --version 2>/dev/null || echo "unknown")
if [[ "$dotnet_ver" == 8.* ]]; then
  pass ".NET version $dotnet_ver"
else
  fail ".NET" "expected 8.x, got $dotnet_ver"
fi

if [ -x "/app/docker-entrypoint.sh" ]; then
  pass "docker-entrypoint.sh is executable"
else
  fail "docker-entrypoint.sh" "missing or not executable"
fi

# ============================================================================
echo ""
echo -e "${BOLD}=== Results: ${GREEN}${PASS} passed${RESET}, ${RED}${FAIL} failed${RESET}, ${YELLOW}${SKIP} skipped${RESET} ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
