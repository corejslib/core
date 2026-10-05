#!/usr/bin/env -S bash

set -Eeuo pipefail
trap 'echo "⚠  Error ($0:$LINENO, exit code: $?): $BASH_COMMAND" >&2' ERR

# Кросс-компиляция FFmpeg для Windows (x86_64, UCRT) на Ubuntu/Debian через mingw-w64
# Результат: статические ffmpeg.exe и ffprobe.exe, слинкованные с Universal CRT
# (импортируют только системные api-ms-win-crt-*.dll; Windows 10/11 — из коробки,
# на Windows 7/8.1 нужен Update for Universal C Runtime).
#
# Нужны пакеты gcc-mingw-w64-ucrt64 / g++-mingw-w64-ucrt64 (префикс x86_64-w64-mingw32ucrt).
# В Debian 13+ они есть. Если их нет в репозиториях (например, Ubuntu 26.04), скрипт сам
# подключает Debian trixie (низкий приоритет, точечный pin только для gcc-mingw-w64-*):
# всё остальное остаётся из Ubuntu. Ubuntu-пакеты msvcrt-тулчейна (gcc-mingw-w64-x86-64*)
# при этом удаляются — вместе с UCRT-компилятором они не уживаются. Отключить: DEBIAN_TRIXIE=0
#
# Включено: x264, x265, libvpx (VP8/VP9), fdk-aac, mp3lame, opus,
#           libaom (AV1), SVT-AV1, dav1d, libvorbis, zlib,
#           freetype, fribidi, harfbuzz, libass (subtitles, drawtext)
# TLS для https — встроенный Windows schannel (вместо gnutls).
# Системные шрифты в libass — через DirectWrite (fontconfig не нужен).
# Дополнительно (каждая необязательна — при ошибке сборки пропускается):
#           libwebp, libjxl, openjpeg, vvenc, rav1e, theora, openh264, xvid,
#           kvazaar, speex, twolame, opencore-amr, soxr, vidstab, rubberband,
#           zimg, srt (без шифрования), bluray, libxml2
# НЕ включено: ffplay (нужен SDL2).
#
# ВНИМАНИЕ: из-за --enable-nonfree (fdk-aac) итоговые .exe
# нельзя распространять — только для личного использования.
#
# Использование:
#   chmod +x build-ffmpeg-windows.sh
#   ./build-ffmpeg-windows.sh            # сборка
#   ./build-ffmpeg-windows.sh --clean    # удалить всё, что создал скрипт
#
# Переменные окружения (необязательно):
#   SOURCES_DIR  исходники          (по умолчанию ~/ffmpeg_sources_win)
#   BUILD_DIR    библиотеки (prefix) (по умолчанию ~/ffmpeg_build_win)
#   BIN_DIR      готовые .exe        (по умолчанию ~/ffmpeg_win64)
#   JOBS         число потоков make  (по умолчанию nproc)
#   FFMPEG_REF   ветка/тег FFmpeg    (по умолчанию release/9.0; можно master или n9.0.1)
#   SKIP_LIBS    необязательные библиотеки, которые не нужно собирать,
#                например: SKIP_LIBS="jxl rav1e" (имена — первый аргумент run_optional)
#   DEBIAN_TRIXIE  1 (по умолчанию) — при отсутствии gcc-mingw-w64-ucrt64 подключить
#                репозиторий Debian trixie; 0 — не трогать настройки apt

FFMPEG_REF="${FFMPEG_REF:-master}"
FFMPEG_BUILD_DIR="${FFMPEG_BUILD_DIR:-$TMP/ffmpeg-build-win32}"

SOURCES_DIR="$FFMPEG_BUILD_DIR/sources"
BUILD_DIR="$FFMPEG_BUILD_DIR/build"
BIN_DIR="$FFMPEG_BUILD_DIR/bin"

OGG_VERSION="1.3.6"
VORBIS_VERSION="1.3.7"
LAME_VERSION="3.100"
FREETYPE_VERSION="2.14.3"
FRIBIDI_VERSION="1.0.17"
HARFBUZZ_VERSION="14.5.1"
LIBASS_VERSION="0.17.5"

JOBS="${JOBS:-$(nproc)}"
HOST="x86_64-w64-mingw32ucrt"

# Нужен posix-вариант потоков (C++ потоки в x265/SVT-AV1). Если отдельных
# *-posix бинарников нет — берём обычные, модель потоков проверяется ниже.
if command -v "${HOST}-gcc-posix" > /dev/null 2>&1; then
    CC="${HOST}-gcc-posix"
    CXX="${HOST}-g++-posix"
else
    CC="${HOST}-gcc"
    CXX="${HOST}-g++"
fi

AR="${HOST}-ar"
RANLIB="${HOST}-ranlib"
STRIP="${HOST}-strip"
WINDRES="${HOST}-windres"

export CC CXX AR RANLIB STRIP WINDRES

# pkg-config должен видеть ТОЛЬКО наши Windows-библиотеки, а не хостовые
unset PKG_CONFIG_PATH
export PKG_CONFIG_LIBDIR="$BUILD_DIR/lib/pkgconfig:$BUILD_DIR/share/pkgconfig"
export ACLOCAL_PATH="$BUILD_DIR/share/aclocal"

TOOLCHAIN_FILE="$SOURCES_DIR/toolchain-mingw64.cmake"
MESON_CROSS_FILE="$SOURCES_DIR/meson-mingw64.txt"

TRIXIE_LIST="/etc/apt/sources.list.d/debian-trixie.list"
TRIXIE_PREFS="/etc/apt/preferences.d/debian-trixie"

log() {
    printf '\n\033[1;32m==> %s\033[0m\n' "$*"
}

# Клонирует репозиторий или обновляет уже существующий
git_fetch() {
    local url="$1" dir="$2" branch="${3:-}"

    if [ -d "$dir/.git" ]; then
        git -C "$dir" pull --ff-only || true
    else
        if [ -n "$branch" ]; then
            git clone --depth 1 --branch "$branch" "$url" "$dir"
        else
            git clone --depth 1 "$url" "$dir"
        fi
    fi
}

# --------------------------------------------------- необязательные библиотеки
# Если библиотека не собралась — пропускаем её и идём дальше.
# Отключить вручную: SKIP_LIBS="jxl rav1e" ./build-ffmpeg-windows.sh
OPTIONAL_FLAGS=()
FAILED_LIBS=()

is_skipped() {
    case " ${SKIP_LIBS:-} " in
        *" $1 "*) return 0 ;;
    esac

    return 1
}

run_optional() {
    local name="$1" fn="$2" status=0

    shift 2

    if is_skipped "$name"; then
        log "$name — пропущено (SKIP_LIBS)"
        return 0
    fi

    mkdir -p "$FFMPEG_BUILD_DIR/logs"
    local lib_log="$FFMPEG_BUILD_DIR/logs/$name.log"

    (
        set -e
        "$fn"
    ) 2>&1 | tee "$lib_log" || status=${PIPESTATUS[0]}

    if [ "$status" -eq 0 ]; then
        OPTIONAL_FLAGS+=("$@")
    else
        FAILED_LIBS+=("$name")
        printf '\n!!! %s не собралась — продолжаю без неё. Последние строки (полный лог: %s):\n' "$name" "$lib_log"
        tail -n 30 "$lib_log" || true
    fi
}

configure_ffmpeg() {
    local -a optional=("$@")
    local cfg_log="$PWD/configure-attempt.log" status name flag f found dropped

    while true; do
        set +e
        status=0
        ./configure "${FFMPEG_FLAGS[@]}" "${optional[@]}" 2>&1 | tee "$cfg_log" || status=${PIPESTATUS[0]}
        set -e

        if [ "$status" -eq 0 ]; then
            return 0
        fi

        name="$(grep -oE 'ERROR: [A-Za-z0-9_+.-]+' "$cfg_log" | head -n 1 | sed 's/^ERROR: //' || true)"

        # Имя из pkg-config не всегда совпадает с флагом configure
        case "$name" in
            libopenjp2) name="libopenjpeg" ;;
            libxml-2.0) name="libxml2" ;;
        esac

        found=0
        local -a rest=()

        for f in "${optional[@]}"; do
            flag="${f#--enable-}"

            if [ -n "$name" ] && { [ "$flag" = "${name//_/-}" ] || [ "$flag" = "lib${name//_/-}" ]; }; then
                found=1
                dropped="$f"
            else
                rest+=("$f")
            fi
        done

        if [ "$found" -eq 0 ]; then
            echo "configure упал не из-за необязательной библиотеки — см. ffbuild/config.log" >&2
            return 1
        fi

        log "Отключаю $dropped (не найдена или не слинковалась), пробую снова"
        FAILED_LIBS+=("$name")
        optional=("${rest[@]}")
    done
}

# Кросс-сборка cmake-проекта: cross_cmake <исходники> <каталог сборки> [опции cmake]
# (пути — относительно $SOURCES_DIR)
cross_cmake() {
    local src="$1" bdir="$2"

    shift 2
    cd "$SOURCES_DIR"
    rm -rf "$bdir"
    cmake -S "$src" -B "$bdir" -G "Unix Makefiles" \
        -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE" \
        -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
        "$@"
    cmake --build "$bdir" -j"$JOBS"
    cmake --install "$bdir"
}

# Скачивает и распаковывает tarball в $SOURCES_DIR и переходит в каталог $2
fetch_tarball() {
    local url="$1" dir="$2"

    cd "$SOURCES_DIR"
    wget -nc "$url" || [ -f "${url##*/}" ]
    rm -rf "$dir"
    tar xf "${url##*/}"
    cd "$dir"
}

# Стандартная кросс-сборка autotools-проекта в текущем каталоге
cross_autotools() {
    ./configure \
        --host="$HOST" \
        --prefix="$BUILD_DIR" \
        --disable-shared \
        --enable-static \
        "$@"
    make -j"$JOBS"
    make install
}

# ---------------------------------------------------------------- clean
if [ "${1:-}" = "--clean" ]; then
    log "Удаляю $SOURCES_DIR, $BUILD_DIR и $BIN_DIR"
    rm -rf "$SOURCES_DIR" "$BUILD_DIR" "$BIN_DIR"

    # Репозиторий Debian trixie, если его добавил этот скрипт (установленные пакеты остаются)
    if [ -f "$TRIXIE_LIST" ] || [ -f "$TRIXIE_PREFS" ]; then
        log "Удаляю настройки apt для Debian trixie"
        sudo rm -f "$TRIXIE_LIST" "$TRIXIE_PREFS"
        sudo apt-get update -qq || true
    fi

    exit 0
fi

mkdir -p "$SOURCES_DIR" "$BUILD_DIR" "$BIN_DIR"

# ---------------------------------------------------------- dependencies
log "Установка системных зависимостей"
sudo apt-get update -qq

# Ubuntu-пакеты msvcrt-тулчейна (gcc-mingw-w64-x86-64* и т.п.) жёстко привязаны к
# версии gcc-mingw-w64-base из Ubuntu, а UCRT-компилятор из Debian — к версии из
# Debian. Одновременно они поставлены быть не могут, поэтому старые удаляем.
remove_msvcrt_toolchain() {
    local -a old=()

    mapfile -t old < <(
        dpkg-query -W -f='${db:Status-Abbrev} ${binary:Package}\n' 'gcc-mingw-w64*' 'g++-mingw-w64*' 2> /dev/null \
            | awk '$1 == "ii" && $2 !~ /ucrt64/ && $2 != "gcc-mingw-w64-base" { print $2 }'
    )

    if [ "${#old[@]}" -gt 0 ]; then
        log "Удаляю msvcrt-тулчейн из Ubuntu (конфликтует с UCRT из Debian): ${old[*]}"
        sudo apt-get -y remove "${old[@]}"
    fi
}

# UCRT-кросс-компилятор есть в Debian 13+, но может отсутствовать в Ubuntu.
# Подключаем trixie: для всех пакетов приоритет 100 (Ubuntu остаётся главным),
# а для семейства gcc-mingw-w64-ucrt64 и gcc-mingw-w64-base — 990, чтобы apt
# выбирал их версии из trixie (их зависимости требуют точное совпадение версий).
ensure_ucrt_toolchain_repo() {
    if [ ! -f "$TRIXIE_LIST" ]; then
        if apt-cache show gcc-mingw-w64-ucrt64 > /dev/null 2>&1; then
            return 0
        fi

        if [ "${DEBIAN_TRIXIE:-1}" != "1" ]; then
            echo "В репозиториях нет gcc-mingw-w64-ucrt64, а DEBIAN_TRIXIE=0 запрещает подключать Debian trixie." >&2
            return 1
        fi
    fi

    log "Подключаю Debian trixie для UCRT-тулчейна"
    sudo apt-get -y install debian-archive-keyring

    echo "deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] http://deb.debian.org/debian trixie main" \
        | sudo tee "$TRIXIE_LIST" > /dev/null
    printf 'Package: *\nPin: release n=trixie\nPin-Priority: 100\n\nPackage: gcc-mingw-w64-base gcc-mingw-w64-ucrt64* g++-mingw-w64-ucrt64*\nPin: release n=trixie\nPin-Priority: 990\n' \
        | sudo tee "$TRIXIE_PREFS" > /dev/null

    sudo apt-get update -qq
    remove_msvcrt_toolchain

    apt-cache show gcc-mingw-w64-ucrt64 > /dev/null 2>&1
}

# Установка пакетов; если новый solver apt (3.x) не справился с зависимостями —
# повторяем классическим (-o APT::Solver=internal)
apt_install() {
    sudo apt-get -y install "$@" \
        || sudo apt-get -y -o APT::Solver=internal install "$@"
}

ensure_ucrt_toolchain_repo || {
    echo "Не удалось получить gcc-mingw-w64-ucrt64. Варианты: Debian 13 (контейнер/chroot)" >&2
    echo "или готовый тулчейн (например llvm-mingw, ucrt-вариант)." >&2
    exit 1
}

apt_install \
    autoconf \
    automake \
    binutils-mingw-w64-ucrt64 \
    build-essential \
    bzip2 \
    cmake \
    curl \
    g++-mingw-w64-ucrt64 \
    gcc-mingw-w64-ucrt64 \
    git-core \
    libtool \
    meson \
    mingw-w64-tools \
    nasm \
    ninja-build \
    pkg-config \
    python3 \
    texinfo \
    wget \
    xz-utils \
    yasm

for tool in "$CC" "$CXX" "$AR" "$RANLIB" "$STRIP" "$WINDRES"; do
    command -v "$tool" > /dev/null || {
        echo "Не найден $tool — проверьте установку пакетов mingw-w64" >&2
        exit 1
    }
done

# x265/SVT-AV1 требуют posix-потоки (std::thread и т.п.)
thread_model="$("$CXX" -v 2>&1 | sed -n 's/^Thread model: //p' || true)"

if [ "$thread_model" != "posix" ]; then
    echo "$CXX использует модель потоков '$thread_model', а нужна posix." >&2
    echo "Нужен posix-вариант тулчейна (проверь ls /usr/bin/${HOST}-g++* и update-alternatives)." >&2
    exit 1
fi

# ------------------------------------------- toolchain-файлы (cmake/meson)
cat > "$TOOLCHAIN_FILE" << EOF
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER ${CC})
set(CMAKE_CXX_COMPILER ${CXX})
set(CMAKE_RC_COMPILER ${WINDRES})
set(CMAKE_AR ${AR})
set(CMAKE_RANLIB ${RANLIB})
set(CMAKE_FIND_ROOT_PATH /usr/${HOST} ${BUILD_DIR})
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
EOF

cat > "$MESON_CROSS_FILE" << EOF
[binaries]
c = '${CC}'
cpp = '${CXX}'
ar = '${AR}'
strip = '${STRIP}'
windres = '${WINDRES}'
pkg-config = 'pkg-config'

[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'

[properties]
needs_exe_wrapper = true
pkg_config_libdir = ['${BUILD_DIR}/lib/pkgconfig', '${BUILD_DIR}/share/pkgconfig']
EOF

# ------------------------------------------------------------------ zlib
log "zlib"
cd "$SOURCES_DIR"
git_fetch https://github.com/madler/zlib.git zlib v1.3.2
cd zlib
make distclean > /dev/null 2>&1 || true
CHOST="$HOST" ./configure --prefix="$BUILD_DIR" --static
make -j"$JOBS"
make install

# ------------------------------------------------------------------ x264
log "libx264 (H.264)"
cd "$SOURCES_DIR"
git_fetch https://code.videolan.org/videolan/x264.git x264 stable
cd x264
make distclean > /dev/null 2>&1 || true
./configure \
    --host="$HOST" \
    --cross-prefix="${HOST}-" \
    --prefix="$BUILD_DIR" \
    --enable-static \
    --enable-pic \
    --disable-cli
make -j"$JOBS"
make install

# ------------------------------------------------------------------ x265
log "libx265 (H.265/HEVC)"
cd "$SOURCES_DIR"
# x265 определяет свою версию по git-тегам, поэтому shallow-клон (--depth 1)
# не подходит: без тегов cmake падает с "list GET given empty list".
if [ -d x265_git/.git ]; then
    git -C x265_git fetch --tags --unshallow 2> /dev/null || git -C x265_git fetch --tags
    git -C x265_git pull --ff-only || true
else
    git clone https://bitbucket.org/multicoreware/x265_git.git x265_git
fi
rm -rf x265_git/build/mingw
mkdir -p x265_git/build/mingw
cd x265_git/build/mingw
cmake -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE" \
    -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
    -DENABLE_SHARED=off \
    -DENABLE_CLI=OFF \
    ../../source
make -j"$JOBS"
make install

# Некоторые ревизии x265 не устанавливают x265.pc — создаём его сами
X265_PC="$BUILD_DIR/lib/pkgconfig/x265.pc"

if [ ! -f "$X265_PC" ]; then
    found_pc="$(find "$BUILD_DIR" -name x265.pc -print -quit)"

    if [ -n "$found_pc" ]; then
        mkdir -p "$(dirname "$X265_PC")"
        cp "$found_pc" "$X265_PC"
    else
        log "x265.pc не был установлен — создаю вручную"
        X265_VERSION="$(git -C "$SOURCES_DIR/x265_git" describe --tags 2> /dev/null | sed 's/^v//' || true)"
        mkdir -p "$(dirname "$X265_PC")"
        cat > "$X265_PC" << EOF
prefix=$BUILD_DIR
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: x265
Description: H.265/HEVC video encoder
Version: ${X265_VERSION:-0.0}
Libs: -L\${libdir} -lx265
Libs.private: -lstdc++ -lm
Cflags: -I\${includedir}
EOF
    fi
fi

# ----------------------------------------------------------------- libvpx
log "libvpx (VP8/VP9)"
cd "$SOURCES_DIR"
git_fetch https://chromium.googlesource.com/webm/libvpx.git libvpx
cd libvpx
make distclean > /dev/null 2>&1 || true
CROSS="${HOST}-" ./configure \
    --target=x86_64-win64-gcc \
    --prefix="$BUILD_DIR" \
    --disable-examples \
    --disable-tools \
    --disable-docs \
    --disable-unit-tests \
    --enable-vp9-highbitdepth \
    --enable-static \
    --disable-shared \
    --as=yasm
make -j"$JOBS"
make install

# --------------------------------------------------------------- fdk-aac
log "libfdk-aac (AAC)"
cd "$SOURCES_DIR"
git_fetch https://github.com/mstorsjo/fdk-aac fdk-aac
cd fdk-aac
make distclean > /dev/null 2>&1 || true
autoreconf -fiv
./configure \
    --host="$HOST" \
    --prefix="$BUILD_DIR" \
    --disable-shared \
    --enable-static
make -j"$JOBS"
make install

# ------------------------------------------------------------------ lame
log "libmp3lame (MP3)"
cd "$SOURCES_DIR"
wget -nc "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz" || true
rm -rf "lame-$LAME_VERSION"
tar xzf "lame-$LAME_VERSION.tar.gz"
cd "lame-$LAME_VERSION"
./configure \
    --host="$HOST" \
    --prefix="$BUILD_DIR" \
    --disable-shared \
    --enable-static \
    --disable-frontend
make -j"$JOBS"
make install

# ------------------------------------------------------------------ opus
log "libopus"
cd "$SOURCES_DIR"
git_fetch https://github.com/xiph/opus.git opus
cd opus
make distclean > /dev/null 2>&1 || true
./autogen.sh
./configure \
    --host="$HOST" \
    --prefix="$BUILD_DIR" \
    --disable-shared \
    --enable-static \
    --disable-doc \
    --disable-extra-programs
make -j"$JOBS"
make install

# ------------------------------------------------------------ ogg + vorbis
log "libogg $OGG_VERSION"
cd "$SOURCES_DIR"
wget -nc "https://downloads.xiph.org/releases/ogg/libogg-$OGG_VERSION.tar.xz" || true
rm -rf "libogg-$OGG_VERSION"
tar xf "libogg-$OGG_VERSION.tar.xz"
cd "libogg-$OGG_VERSION"
./configure \
    --host="$HOST" \
    --prefix="$BUILD_DIR" \
    --disable-shared \
    --enable-static
make -j"$JOBS"
make install

log "libvorbis $VORBIS_VERSION"
cd "$SOURCES_DIR"
wget -nc "https://downloads.xiph.org/releases/vorbis/libvorbis-$VORBIS_VERSION.tar.xz" || true
rm -rf "libvorbis-$VORBIS_VERSION"
tar xf "libvorbis-$VORBIS_VERSION.tar.xz"
cd "libvorbis-$VORBIS_VERSION"
./configure \
    --host="$HOST" \
    --prefix="$BUILD_DIR" \
    --with-ogg="$BUILD_DIR" \
    --disable-shared \
    --enable-static \
    --disable-oggtest \
    --disable-docs \
    --disable-examples
make -j"$JOBS"
make install

# ------------------------------------------------ freetype / fribidi / harfbuzz / libass
log "freetype $FREETYPE_VERSION"
cd "$SOURCES_DIR"
wget -nc "https://download.savannah.gnu.org/releases/freetype/freetype-$FREETYPE_VERSION.tar.xz" || true
rm -rf "freetype-$FREETYPE_VERSION"
tar xf "freetype-$FREETYPE_VERSION.tar.xz"
cd "freetype-$FREETYPE_VERSION"
# harfbuzz собираем позже, поэтому здесь без него (циклическая зависимость)
./configure \
    --host="$HOST" \
    --prefix="$BUILD_DIR" \
    --disable-shared \
    --enable-static \
    --with-zlib=yes \
    --with-harfbuzz=no \
    --with-png=no \
    --with-bzip2=no \
    --with-brotli=no
make -j"$JOBS"
make install

log "fribidi $FRIBIDI_VERSION"
cd "$SOURCES_DIR"
wget -nc "https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI_VERSION/fribidi-$FRIBIDI_VERSION.tar.xz" || true
rm -rf "fribidi-$FRIBIDI_VERSION"
tar xf "fribidi-$FRIBIDI_VERSION.tar.xz"
cd "fribidi-$FRIBIDI_VERSION"
meson setup build-mingw \
    --cross-file "$MESON_CROSS_FILE" \
    --buildtype release \
    --default-library=static \
    --wrap-mode=nofallback \
    -Ddocs=false \
    -Dbin=false \
    -Dtests=false \
    --prefix "$BUILD_DIR" \
    --libdir lib
ninja -C build-mingw
ninja -C build-mingw install

log "harfbuzz $HARFBUZZ_VERSION"
cd "$SOURCES_DIR"
wget -nc "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ_VERSION/harfbuzz-$HARFBUZZ_VERSION.tar.xz" || true
rm -rf "harfbuzz-$HARFBUZZ_VERSION"
tar xf "harfbuzz-$HARFBUZZ_VERSION.tar.xz"
cd "harfbuzz-$HARFBUZZ_VERSION"
meson setup build-mingw \
    --cross-file "$MESON_CROSS_FILE" \
    --buildtype release \
    --default-library=static \
    --wrap-mode=nofallback \
    -Dfreetype=enabled \
    -Dglib=disabled \
    -Dgobject=disabled \
    -Dcairo=disabled \
    -Dicu=disabled \
    -Dtests=disabled \
    -Ddocs=disabled \
    -Dbenchmark=disabled \
    -Dutilities=disabled \
    -Dintrospection=disabled \
    --prefix "$BUILD_DIR" \
    --libdir lib
ninja -C build-mingw
ninja -C build-mingw install

log "libass $LIBASS_VERSION"
cd "$SOURCES_DIR"
wget -nc "https://github.com/libass/libass/releases/download/$LIBASS_VERSION/libass-$LIBASS_VERSION.tar.xz" || true
rm -rf "libass-$LIBASS_VERSION"
tar xf "libass-$LIBASS_VERSION.tar.xz"
cd "libass-$LIBASS_VERSION"
./configure \
    --host="$HOST" \
    --prefix="$BUILD_DIR" \
    --disable-shared \
    --enable-static \
    --disable-fontconfig
make -j"$JOBS"
make install

# ------------------------------------------------------------------- aom
log "libaom (AV1)"
cd "$SOURCES_DIR"
git_fetch https://aomedia.googlesource.com/aom aom
rm -rf aom_build
mkdir -p aom_build
cd aom_build
cmake -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE" \
    -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DENABLE_TESTS=OFF \
    -DENABLE_DOCS=OFF \
    -DENABLE_EXAMPLES=OFF \
    -DENABLE_TOOLS=OFF \
    -DENABLE_NASM=on \
    -DBUILD_SHARED_LIBS=0 \
    ../aom
make -j"$JOBS"
make install

# ---------------------------------------------------------------- SVT-AV1
log "SVT-AV1"
cd "$SOURCES_DIR"
git_fetch https://gitlab.com/AOMediaCodec/SVT-AV1.git SVT-AV1
rm -rf SVT-AV1/build-mingw
mkdir -p SVT-AV1/build-mingw
cd SVT-AV1/build-mingw
cmake -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE" \
    -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_DEC=OFF \
    -DBUILD_APPS=OFF \
    -DBUILD_TESTING=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    ..
make -j"$JOBS"
make install

# ------------------------------------------------------------------ dav1d
log "libdav1d (декодер AV1)"
cd "$SOURCES_DIR"
git_fetch https://code.videolan.org/videolan/dav1d.git dav1d
cd dav1d
rm -rf build-mingw
meson setup build-mingw \
    --cross-file "$MESON_CROSS_FILE" \
    --buildtype release \
    --default-library=static \
    -Denable_tools=false \
    -Denable_tests=false \
    --prefix "$BUILD_DIR" \
    --libdir lib
ninja -C build-mingw
ninja -C build-mingw install

# ------------------------------------------------- дополнительные библиотеки
# Каждая из них необязательная: если сборка упадёт, скрипт пропустит её
# и продолжит без неё. Итоговый список пропущенных выводится в конце.

build_webp() {
    log "libwebp"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/webmproject/libwebp.git libwebp v1.6.0
    cross_cmake libwebp libwebp/build-mingw \
        -DWEBP_BUILD_ANIM_UTILS=OFF \
        -DWEBP_BUILD_CWEBP=OFF \
        -DWEBP_BUILD_DWEBP=OFF \
        -DWEBP_BUILD_GIF2WEBP=OFF \
        -DWEBP_BUILD_IMG2WEBP=OFF \
        -DWEBP_BUILD_VWEBP=OFF \
        -DWEBP_BUILD_WEBPINFO=OFF \
        -DWEBP_BUILD_WEBPMUX=OFF \
        -DWEBP_BUILD_EXTRAS=OFF
}

build_jxl() {
    log "libjxl (JPEG XL)"
    cd "$SOURCES_DIR"

    if [ ! -d libjxl/.git ]; then
        git clone --depth 1 --branch v0.12.0 --recursive --shallow-submodules \
            https://github.com/libjxl/libjxl.git libjxl
    fi

    cross_cmake libjxl libjxl/build-mingw \
        -DJPEGXL_STATIC=ON \
        -DBUILD_TESTING=OFF \
        -DJPEGXL_ENABLE_TOOLS=OFF \
        -DJPEGXL_ENABLE_DOXYGEN=OFF \
        -DJPEGXL_ENABLE_MANPAGES=OFF \
        -DJPEGXL_ENABLE_BENCHMARK=OFF \
        -DJPEGXL_ENABLE_EXAMPLES=OFF \
        -DJPEGXL_ENABLE_JNI=OFF \
        -DJPEGXL_ENABLE_SJPEG=OFF \
        -DJPEGXL_ENABLE_OPENEXR=OFF \
        -DJPEGXL_ENABLE_PLUGINS=OFF \
        -DJPEGXL_ENABLE_VIEWERS=OFF \
        -DJPEGXL_ENABLE_JPEGLI=OFF
}

build_openjpeg() {
    log "openjpeg"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/uclouvain/openjpeg.git openjpeg v2.5.4
    cross_cmake openjpeg openjpeg/build-mingw \
        -DBUILD_CODEC=OFF \
        -DBUILD_TESTING=OFF \
        -DBUILD_DOC=OFF \
        -DBUILD_PKGCONFIG_FILES=ON
}

build_vvenc_win() {
    log "libvvenc (H.266/VVC)"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/fraunhoferhhi/vvenc.git vvenc v1.14.0
    cross_cmake vvenc vvenc/build-mingw \
        -DVVENC_ENABLE_LINK_TIME_OPT=OFF \
        -DVVENC_INSTALL_FULLFEATURE_APP=OFF
}

build_rav1e() {
    log "librav1e (AV1, Rust)"

    if ! command -v cargo > /dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    fi

    export PATH="$HOME/.cargo/bin:$PATH"
    rustup target add x86_64-pc-windows-gnu

    # cargo-c ставим готовым бинарником: сборка из исходников ломается из-за
    # CC=mingw-gcc и PKG_CONFIG_LIBDIR (openssl-sys не находит хостовый openssl)
    if ! cargo cinstall --help > /dev/null 2>&1; then
        mkdir -p "$HOME/.cargo/bin"
        curl -fsSL https://github.com/lu-zero/cargo-c/releases/latest/download/cargo-c-x86_64-unknown-linux-musl.tar.gz \
            | tar xz -C "$HOME/.cargo/bin"
    fi

    cd "$SOURCES_DIR"
    git_fetch https://github.com/xiph/rav1e.git rav1e v0.8.1
    cd rav1e
    # Сбрасываем CC/CXX хоста, чтобы build-скрипты Rust собирались обычным gcc
    env -u CC -u CXX -u AR -u RANLIB -u STRIP -u WINDRES -u PKG_CONFIG_LIBDIR \
        CC_x86_64_pc_windows_gnu="$CC" \
        CXX_x86_64_pc_windows_gnu="$CXX" \
        AR_x86_64_pc_windows_gnu="$AR" \
        CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="$CC" \
        cargo cinstall --release \
        --target x86_64-pc-windows-gnu \
        --prefix "$BUILD_DIR" \
        --libdir "$BUILD_DIR/lib" \
        --library-type staticlib \
        --crt-static

    # staticlib для rust-таргета windows-gnu тянет -lmsvcrt — это смешало бы
    # msvcrt и UCRT в одном .exe
    if [ -f "$BUILD_DIR/lib/pkgconfig/rav1e.pc" ]; then
        sed -i 's/-lmsvcrt//g' "$BUILD_DIR/lib/pkgconfig/rav1e.pc"
    fi
}

build_theora() {
    log "libtheora"
    fetch_tarball https://downloads.xiph.org/releases/theora/libtheora-1.2.0.tar.gz libtheora-1.2.0
    cross_autotools \
        --disable-examples \
        --disable-spec \
        --disable-oggtest \
        --disable-vorbistest \
        --disable-sdltest \
        --with-ogg="$BUILD_DIR" \
        --with-vorbis="$BUILD_DIR"
}

build_openh264() {
    log "libopenh264"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/cisco/openh264.git openh264 v2.6.0
    cd openh264
    rm -rf build-mingw
    meson setup build-mingw \
        --cross-file "$MESON_CROSS_FILE" \
        --buildtype release \
        --default-library=static \
        -Dtests=disabled \
        --prefix "$BUILD_DIR" \
        --libdir lib
    ninja -C build-mingw
    ninja -C build-mingw install
}

build_xvid() {
    log "libxvid"
    fetch_tarball https://downloads.xvid.com/downloads/xvidcore-1.3.7.tar.gz xvidcore/build/generic
    ./configure --host="$HOST" --prefix="$BUILD_DIR"

    # Современный gcc/mingw не знает флаг -mno-cygwin, который configure пишет в platform.inc
    sed -i 's/-mno-cygwin//g' platform.inc

    make -j1

    # Ставим вручную только статику и заголовок (make install на mingw тащит DLL)
    local static_lib
    static_lib="$(find . -name xvidcore.a -print -quit)"
    [ -n "$static_lib" ]
    mkdir -p "$BUILD_DIR/lib" "$BUILD_DIR/include"
    cp "$static_lib" "$BUILD_DIR/lib/libxvidcore.a"
    cp ../../src/xvid.h "$BUILD_DIR/include/xvid.h"
}

build_kvazaar() {
    log "libkvazaar"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/ultravideo/kvazaar.git kvazaar v2.3.2
    cd kvazaar
    ./autogen.sh
    cross_autotools
}

build_speex() {
    log "libspeex"
    fetch_tarball https://downloads.xiph.org/releases/speex/speex-1.2.1.tar.gz speex-1.2.1
    cross_autotools --disable-binaries
}

build_twolame() {
    log "libtwolame"
    fetch_tarball https://downloads.sourceforge.net/project/twolame/twolame/0.4.0/twolame-0.4.0.tar.gz twolame-0.4.0
    cross_autotools --disable-sndfile
}

build_amr() {
    log "opencore-amr"
    fetch_tarball https://downloads.sourceforge.net/project/opencore-amr/opencore-amr/opencore-amr-0.1.6.tar.gz opencore-amr-0.1.6
    cross_autotools
}

build_soxr() {
    log "libsoxr"
    fetch_tarball https://downloads.sourceforge.net/project/soxr/soxr-0.1.3-Source.tar.xz soxr-0.1.3-Source
    cross_cmake soxr-0.1.3-Source soxr-0.1.3-Source/build-mingw \
        -DBUILD_TESTS=OFF \
        -DBUILD_EXAMPLES=OFF \
        -DWITH_OPENMP=OFF \
        -DWITH_LSR_BINDINGS=OFF
}

build_vidstab() {
    log "libvidstab"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/georgmartius/vid.stab.git vid.stab v1.1.2
    cross_cmake vid.stab vid.stab/build-mingw \
        -DUSE_OMP=OFF
}

build_rubberband() {
    log "librubberband"
    fetch_tarball https://breakfastquay.com/files/releases/rubberband-4.0.0.tar.bz2 rubberband-4.0.0
    rm -rf build-mingw
    meson setup build-mingw \
        --cross-file "$MESON_CROSS_FILE" \
        --buildtype release \
        --default-library=static \
        -Dfft=builtin \
        -Dresampler=builtin \
        -Dcmdline=disabled \
        -Dladspa=disabled \
        -Dlv2=disabled \
        -Dvamp=disabled \
        -Djni=disabled \
        --prefix "$BUILD_DIR" \
        --libdir lib
    ninja -C build-mingw
    ninja -C build-mingw install
}

build_zimg() {
    log "libzimg"
    cd "$SOURCES_DIR"

    if [ ! -d zimg/.git ]; then
        git clone --depth 1 --branch release-3.0.6 --recursive --shallow-submodules \
            https://github.com/sekrit-twc/zimg.git zimg
    fi

    cd zimg
    ./autogen.sh
    cross_autotools \
        --disable-testapp \
        --disable-example \
        --disable-unit-test
}

build_srt() {
    log "libsrt (без шифрования)"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/Haivision/srt.git srt v1.5.7
    cross_cmake srt srt/build-mingw \
        -DENABLE_SHARED=OFF \
        -DENABLE_STATIC=ON \
        -DENABLE_APPS=OFF \
        -DENABLE_UNITTESTS=OFF \
        -DENABLE_ENCRYPTION=OFF
}

build_bluray() {
    log "libbluray"
    fetch_tarball https://download.videolan.org/pub/videolan/libbluray/1.3.4/libbluray-1.3.4.tar.bz2 libbluray-1.3.4

    # В libbluray глобальный символ dec_init совпадает с dec_init из
    # fftools/ffmpeg_dec.c -> "multiple definition" при статической линковке.
    # Переименовываем его при сборке libbluray (distclean — чтобы пересобрать
    # объектные файлы, если каталог остался от прошлого запуска).
    make distclean > /dev/null 2>&1 || true

    cross_autotools \
        CPPFLAGS="-Ddec_init=bd_dec_init" \
        --disable-examples \
        --disable-bdjava-jar \
        --disable-doxygen-doc \
        --without-libxml2 \
        --without-freetype \
        --without-fontconfig
}

build_xml2() {
    log "libxml2"
    fetch_tarball https://download.gnome.org/sources/libxml2/2.15/libxml2-2.15.4.tar.xz libxml2-2.15.4
    cross_autotools \
        --without-python \
        --without-iconv \
        --without-icu \
        --without-readline \
        --with-zlib="$BUILD_DIR"
}

run_optional webp build_webp --enable-libwebp
run_optional jxl build_jxl --enable-libjxl
run_optional openjpeg build_openjpeg --enable-libopenjpeg
run_optional vvenc build_vvenc_win --enable-libvvenc
run_optional rav1e build_rav1e --enable-librav1e
run_optional theora build_theora --enable-libtheora
run_optional openh264 build_openh264 --enable-libopenh264
run_optional xvid build_xvid --enable-libxvid
run_optional kvazaar build_kvazaar --enable-libkvazaar
run_optional speex build_speex --enable-libspeex
run_optional twolame build_twolame --enable-libtwolame
run_optional amr build_amr --enable-libopencore-amrnb --enable-libopencore-amrwb
run_optional soxr build_soxr --enable-libsoxr
run_optional vidstab build_vidstab --enable-libvidstab
run_optional rubberband build_rubberband --enable-librubberband
run_optional zimg build_zimg --enable-libzimg
run_optional srt build_srt --enable-libsrt
run_optional bluray build_bluray --enable-libbluray
run_optional xml2 build_xml2 --enable-libxml2

# ----------------------------------------------------------------- ffmpeg
log "FFmpeg ($FFMPEG_REF)"
cd "$SOURCES_DIR"
git_fetch https://git.ffmpeg.org/ffmpeg.git ffmpeg "$FFMPEG_REF"
cd ffmpeg
make distclean > /dev/null 2>&1 || true

STATIC_DEFINES="-DLIBXML_STATIC -DLIBTWOLAME_STATIC -DOPJ_STATIC -DKVZ_STATIC_LIB"
STATIC_DEFINES="$STATIC_DEFINES -DJXL_STATIC_DEFINE -DJXL_THREADS_STATIC_DEFINE -DJXL_CMS_STATIC_DEFINE"

FFMPEG_FLAGS=(
    --prefix="$BUILD_DIR"
    --bindir="$BIN_DIR"
    --enable-cross-compile
    --arch=x86_64
    --target-os=mingw32
    --cross-prefix="${HOST}-"
    --cc="$CC"
    --cxx="$CXX"
    --ld="$CXX"
    --pkg-config=pkg-config
    --pkg-config-flags="--static"
    --extra-cflags="-I$BUILD_DIR/include $STATIC_DEFINES"
    --extra-ldflags="-L$BUILD_DIR/lib -static"
    --extra-libs="-lpthread -lm"
    --disable-doc
    --disable-ffplay
    --enable-gpl
    --enable-version3
    --enable-schannel
    --enable-zlib
    --enable-libaom
    --enable-libass
    --enable-libdav1d
    --enable-libfdk-aac
    --enable-libfreetype
    --enable-libfribidi
    --enable-libharfbuzz
    --enable-libmp3lame
    --enable-libopus
    --enable-libsvtav1
    --enable-libvorbis
    --enable-libvpx
    --enable-libx264
    --enable-libx265
    --enable-nonfree
)

# Необязательные библиотеки, которые не подошли configure, отключаются
# автоматически (см. configure_ffmpeg) — сборка продолжится без них.
configure_ffmpeg "${OPTIONAL_FLAGS[@]}"

make -j"$JOBS"
make install

# ----------------------------------------------------------------- verify
# В UCRT-сборке .exe не должны импортировать msvcrt.dll
for exe in "$BIN_DIR/ffmpeg.exe" "$BIN_DIR/ffprobe.exe"; do
    mixed="$("${HOST}-objdump" -p "$exe" | grep -i 'DLL Name: msvcrt\.dll' || true)"

    if [ -n "$mixed" ]; then
        echo "⚠  $exe импортирует msvcrt.dll — в сборке смешаны CRT (проверь необязательные библиотеки, особенно rav1e)" >&2
    fi
done

# ----------------------------------------------------------------- done
log "Готово!"

if [ "${#FAILED_LIBS[@]}" -gt 0 ]; then
    echo "Не подключены (не собрались/не нашлись): ${FAILED_LIBS[*]}"
fi
