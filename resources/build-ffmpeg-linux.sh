#!/usr/bin/env -S bash

set -Eeuo pipefail
trap 'echo "⚠  Error ($0:$LINENO, exit code: $?): $BASH_COMMAND" >&2' ERR

# Полная сборка FFmpeg из исходников на Ubuntu
# По мотивам: https://trac.ffmpeg.org/wiki/CompilationGuide/Ubuntu
#
# Собирается ffmpeg/ffprobe (без ffplay) с кодеками:
#   x264, x265, libvpx (VP8/VP9), fdk-aac, mp3lame, opus,
#   libaom (AV1), SVT-AV1, dav1d, libvorbis, libass, freetype, openssl
#
# Бинарники линкуются полностью статически (-static): ldd покажет
# "not a dynamic executable", никаких .so на целевой машине не нужно.
# Из-за этого отключены VAAPI/VDPAU (им нужны драйверы через dlopen).
#
# ВНИМАНИЕ: из-за --enable-nonfree (fdk-aac) итоговый бинарник
# нельзя распространять — только для личного использования.
#
# Использование:
#   chmod +x build-ffmpeg-ubuntu.sh
#   ./build-ffmpeg-ubuntu.sh            # обычная сборка
#   ./build-ffmpeg-ubuntu.sh --clean    # удалить всё, что создал скрипт
#
# Переменные окружения (необязательно):
#   SOURCES_DIR  куда качать исходники   (по умолчанию ~/ffmpeg_sources)
#   BUILD_DIR    куда ставить библиотеки (по умолчанию ~/ffmpeg_build)
#   BIN_DIR      куда ставить бинарники  (по умолчанию ~/bin)
#   JOBS         число потоков make      (по умолчанию nproc)
#   FFMPEG_REF   ветка/тег FFmpeg        (по умолчанию release/9.0; можно master или n9.0.1)
#   HARFBUZZ_REF ветка/тег harfbuzz      (по умолчанию — ветка по умолчанию репозитория)
#   SKIP_LIBS    необязательные библиотеки, которые не нужно подключать,
#                например: SKIP_LIBS="jxl rav1e" (имена — в списке EXTRA_LIBS ниже)

FFMPEG_REF="${FFMPEG_REF:-master}"
FFMPEG_BUILD_DIR="${FFMPEG_BUILD_DIR:-$TMP/ffmpeg-build-linux}"

SOURCES_DIR="$FFMPEG_BUILD_DIR/sources"
BUILD_DIR="$FFMPEG_BUILD_DIR/build"
BIN_DIR="$FFMPEG_BUILD_DIR/bin"

NASM_VERSION="2.16.01"
LAME_VERSION="3.100"

JOBS="${JOBS:-$(nproc)}"

export PATH="$BIN_DIR:$PATH"
export PKG_CONFIG_PATH="$BUILD_DIR/lib/pkgconfig"

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
# Отключить вручную: SKIP_LIBS="jxl rav1e" ./build-ffmpeg-ubuntu.sh
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

    (
        set -e
        "$fn"
    ) &
    wait $! || status=$?

    if [ "$status" -eq 0 ]; then
        OPTIONAL_FLAGS+=("$@")
    else
        FAILED_LIBS+=("$name")
        printf '\n!!! %s не собралась — продолжаю без неё\n' "$name"
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

            if [ -f ffbuild/config.log ]; then
                echo "----- ffbuild/config.log (последние 250 строк) -----" >&2
                tail -n 250 ffbuild/config.log >&2
                echo "----- конец config.log -----" >&2
            fi

            return 1
        fi

        log "Отключаю $dropped (не найдена или не слинковалась), пробую снова"
        FAILED_LIBS+=("$name")
        optional=("${rest[@]}")
    done
}

# ---------------------------------------------------------------- clean
if [ "${1:-}" = "--clean" ]; then
    log "Удаляю $SOURCES_DIR, $BUILD_DIR и бинарники из $BIN_DIR"
    rm -rf "$SOURCES_DIR" "$BUILD_DIR"
    rm -f "$BIN_DIR"/{ffmpeg,ffprobe,ffplay,x264,x265,nasm,ndisasm}
    exit 0
fi

mkdir -p "$SOURCES_DIR" "$BUILD_DIR" "$BIN_DIR"

# ---------------------------------------------------------- dependencies
log "Установка системных зависимостей"
sudo apt-get update -qq
sudo apt-get -y install \
    autoconf \
    automake \
    build-essential \
    cmake \
    git-core \
    libass-dev \
    libbrotli-dev \
    libbz2-dev \
    libexpat1-dev \
    libfontconfig-dev \
    libfreetype6-dev \
    libfribidi-dev \
    libharfbuzz-dev \
    libpng-dev \
    libssl-dev \
    libnuma-dev \
    libtool \
    libvorbis-dev \
    libunistring-dev \
    libxcb1-dev \
    libxcb-shm0-dev \
    libxcb-xfixes0-dev \
    meson \
    ninja-build \
    pkg-config \
    texinfo \
    wget \
    yasm \
    zlib1g-dev \
    libzstd-dev

# openssl.pc (Libs.private) в новых Ubuntu требует статические libjitterentropy.a
# и libzstd.a. Пакета libjitterentropy-dev может не быть в старых релизах —
# там OpenSSL этого и не требует, поэтому ошибку установки не считаем фатальной.
sudo apt-get -y install libjitterentropy-dev || true

# ------------------------------------------- цепочка зависимостей libass
# В Ubuntu нет статических libunibreak.a и libharfbuzz.a, а бинарник мы
# линкуем с -static. libass.a, fribidi и fontconfig берём из apt, а эти две
# библиотеки собираем сами в $BUILD_DIR (он стоит первым в PKG_CONFIG_PATH).
build_libunibreak() {
    log "libunibreak (зависимость libass)"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/adah1972/libunibreak.git libunibreak
    cd libunibreak
    make distclean > /dev/null 2>&1 || true
    autoreconf -fiv
    ./configure \
        --prefix="$BUILD_DIR" \
        --disable-shared \
        --enable-static \
        --with-pic
    make -j"$JOBS"
    make install
}

build_harfbuzz() {
    log "harfbuzz (зависимость libass)"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/harfbuzz/harfbuzz.git harfbuzz ${HARFBUZZ_REF:+"$HARFBUZZ_REF"}
    cd harfbuzz
    rm -rf build
    # freetype=disabled: libass'у не нужен hb-ft, а так harfbuzz.pc не зависит
    # от freetype2.pc (который сам требует harfbuzz) — без циклической зависимости.
    meson setup build \
        --prefix="$BUILD_DIR" \
        --libdir=lib \
        --buildtype=release \
        --default-library=static \
        -Dfreetype=disabled \
        -Dglib=disabled \
        -Dgobject=disabled \
        -Dcairo=disabled \
        -Dicu=disabled \
        -Dtests=disabled \
        -Ddocs=disabled \
        -Dbenchmark=disabled \
        -Dutilities=disabled
    ninja -C build -j"$JOBS"
    ninja -C build install
}

# openssl.pc в новых Ubuntu требует статический libjitterentropy.a; если пакета
# нет или в нём нет .a — собираем сами. Библиотека маленькая (несколько .c файлов,
# без зависимостей). Ей нужна сборка без оптимизаций (-O0), как в её Makefile.
build_jitterentropy() {
    log "jitterentropy (зависимость статического OpenSSL)"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/smuellerDD/jitterentropy-library.git jitterentropy-library
    cd jitterentropy-library
    rm -rf .objs
    mkdir .objs

    # Ядро лежит в src/, а платформенный слой (jent_zalloc, jent_zfree,
    # jent_memset_secure, jent_os_random_bytes...) — в arch/ либо в корне.
    # Тесты (tests/) и прочее не берём.
    local src objname
    local -a srcs=()

    while IFS= read -r src; do
        srcs+=("$src")
    done < <(
        find . -maxdepth 1 -name '*.c' -print
        find src arch -maxdepth 1 -name '*.c' -print 2> /dev/null
    )

    echo "jitterentropy: компилирую ${srcs[*]}"

    for src in "${srcs[@]}"; do
        objname="$(echo "${src#./}" | tr '/' '_')"
        gcc -O0 -fwrapv -fPIC -Wall -I. -Isrc -Iarch -c "$src" -o ".objs/${objname%.c}.o"
    done

    mkdir -p "$BUILD_DIR/lib" "$BUILD_DIR/include"
    ar rcs "$BUILD_DIR/lib/libjitterentropy.a" .objs/*.o
    cp jitterentropy.h "$BUILD_DIR/include/"
}

[ -f "$BUILD_DIR/lib/pkgconfig/libunibreak.pc" ] || build_libunibreak
[ -f "$BUILD_DIR/lib/pkgconfig/harfbuzz.pc" ] || build_harfbuzz

# libass обязателен (--enable-libass). При статической сборке pkg-config
# проверяет всю цепочку Requires.private, поэтому падаем заранее и понятно.
if ! pkg-config --static --print-errors "libass >= 0.11.0"; then
    echo "libass не проходит проверку pkg-config --static (см. вывод выше)." >&2
    exit 1
fi

# Именно так configure проверяет libass: собирает и линкует тестовую программу
# статически. Если здесь ошибка линковки — она же будет и у configure.
LIBASS_TEST_DIR="$(mktemp -d)"
printf '#include <ass/ass.h>\nint main(void) { ass_library_init(); return 0; }\n' \
    > "$LIBASS_TEST_DIR/t.c"

# shellcheck disable=SC2046
if ! gcc "$LIBASS_TEST_DIR/t.c" -static \
    $(pkg-config --static --cflags --libs libass) \
    -o "$LIBASS_TEST_DIR/t" -lstdc++ -lpthread -lm; then
    echo "Статическая линковка libass не удалась (ошибки линкера выше)." >&2
    rm -rf "$LIBASS_TEST_DIR"
    exit 1
fi

rm -rf "$LIBASS_TEST_DIR"

# ------------------------------------------------- статический OpenSSL
# openssl.pc (Libs.private) просит -ldl -pthread. В glibc >= 2.34 эти функции
# живут в самой libc, и в новых дистрибутивах отдельных libdl.a / libpthread.a
# может не быть — тогда статическая линковка падает на "cannot find -ldl".
# Кладём пустые заглушки в $BUILD_DIR/lib (он есть в -L), только если файла нет.
for stub in dl pthread rt util; do
    if [ "$(gcc -print-file-name="lib$stub.a")" = "lib$stub.a" ] \
        && [ ! -f "$BUILD_DIR/lib/lib$stub.a" ]; then
        log "lib$stub.a нет в системе — создаю пустую заглушку"
        mkdir -p "$BUILD_DIR/lib"
        ar rcs "$BUILD_DIR/lib/lib$stub.a"
    fi
done

if pkg-config --static --libs openssl | grep -q jitterentropy \
    && [ "$(gcc -print-file-name=libjitterentropy.a)" = "libjitterentropy.a" ]; then
    build_jitterentropy
fi

OPENSSL_TEST_DIR="$(mktemp -d)"
printf '#include <openssl/ssl.h>\nint main(void) { OPENSSL_init_ssl(0, NULL); return 0; }\n' \
    > "$OPENSSL_TEST_DIR/t.c"

echo "openssl static libs: $(pkg-config --static --libs openssl)"

for n in jitterentropy zstd; do
    if pkg-config --static --libs openssl | grep -q "$n" \
        && [ "$(gcc -print-file-name="lib$n.a")" = "lib$n.a" ]; then
        echo "ВНИМАНИЕ: openssl.pc требует lib$n.a, но его нет в системе" >&2
    fi
done

# shellcheck disable=SC2046
if ! gcc "$OPENSSL_TEST_DIR/t.c" -static -L"$BUILD_DIR/lib" \
    $(pkg-config --static --cflags --libs openssl) \
    -o "$OPENSSL_TEST_DIR/t" -lpthread -lm; then
    echo "Статическая линковка openssl не удалась (ошибки линкера выше)." >&2
    rm -rf "$OPENSSL_TEST_DIR"
    exit 1
fi

rm -rf "$OPENSSL_TEST_DIR"

# ------------------------------------------- дополнительные библиотеки (apt)
# Формат: "имя|пакеты apt|флаги configure".
# Пакеты, которых нет в вашей версии Ubuntu, и всё, что не подойдёт при
# линковке, пропускается автоматически.
EXTRA_LIBS=(
    "webp|libwebp-dev|--enable-libwebp"
    "jxl|libjxl-dev|--enable-libjxl"
    "openjpeg|libopenjp2-7-dev|--enable-libopenjpeg"
    "rav1e|librav1e-dev|--enable-librav1e"
    "theora|libtheora-dev|--enable-libtheora"
    "openh264|libopenh264-dev|--enable-libopenh264"
    "xvid|libxvidcore-dev|--enable-libxvid"
    "speex|libspeex-dev|--enable-libspeex"
    "twolame|libtwolame-dev|--enable-libtwolame"
    "amr|libopencore-amrnb-dev libopencore-amrwb-dev|--enable-libopencore-amrnb --enable-libopencore-amrwb"
    "soxr|libsoxr-dev|--enable-libsoxr"
    "rubberband|librubberband-dev|--enable-librubberband"
    "zimg|libzimg-dev|--enable-libzimg"
    "bluray|libbluray-dev|--enable-libbluray"
    "xml2|libxml2-dev|--enable-libxml2"
)

for entry in "${EXTRA_LIBS[@]}"; do
    IFS="|" read -r lib_name lib_pkgs lib_flags <<< "$entry"

    if is_skipped "$lib_name"; then
        log "$lib_name — пропущено (SKIP_LIBS)"
        continue
    fi

    pkgs_ok=1

    for pkg in $lib_pkgs; do
        policy="$(apt-cache policy "$pkg" 2> /dev/null || true)"
        grep -qE 'Candidate: [^(]' <<< "$policy" || pkgs_ok=0
    done

    if [ "$pkgs_ok" = 1 ] && sudo apt-get -y install $lib_pkgs; then
        read -r -a lib_flags_arr <<< "$lib_flags"
        OPTIONAL_FLAGS+=("${lib_flags_arr[@]}")
    else
        FAILED_LIBS+=("$lib_name")
        printf '\n\033[1;33m!!! %s: пакет недоступен в этой Ubuntu — пропускаю\033[0m\n' "$lib_name"
    fi
done

# ------------------------------------------------------------------ NASM
if [ ! -x "$BIN_DIR/nasm" ]; then
    log "NASM $NASM_VERSION"
    cd "$SOURCES_DIR"
    wget -nc "https://www.nasm.us/pub/nasm/releasebuilds/$NASM_VERSION/nasm-$NASM_VERSION.tar.bz2" || true
    tar xjf "nasm-$NASM_VERSION.tar.bz2"
    cd "nasm-$NASM_VERSION"
    ./autogen.sh
    ./configure --prefix="$BUILD_DIR" --bindir="$BIN_DIR"
    make -j"$JOBS"
    make install
else
    log "NASM уже установлен — пропускаю"
fi

# ------------------------------------------------------------------ x264
log "libx264 (H.264)"
cd "$SOURCES_DIR"
git_fetch https://code.videolan.org/videolan/x264.git x264 stable
cd x264
./configure \
    --prefix="$BUILD_DIR" \
    --bindir="$BIN_DIR" \
    --enable-static \
    --enable-pic
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
rm -rf x265_git/build/linux
mkdir -p x265_git/build/linux
cd x265_git/build/linux
cmake -G "Unix Makefiles" \
    -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
    -DENABLE_SHARED=off \
    -DENABLE_CLI=OFF \
    ../../source
make -j"$JOBS"
make install

# Некоторые ревизии x265 не устанавливают x265.pc — тогда создаём его сами,
# иначе FFmpeg не найдёт библиотеку через pkg-config.
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
Libs.private: -lstdc++ -lm -lrt -ldl -lnuma -lpthread
Cflags: -I\${includedir}
EOF
    fi
fi

# Статическая линковка: заменяем -lgcc_s на -lgcc_eh
sed -i 's/-lgcc_s/-lgcc_eh/g' "$X265_PC"

# ----------------------------------------------------------------- libvpx
log "libvpx (VP8/VP9)"
cd "$SOURCES_DIR"
git_fetch https://chromium.googlesource.com/webm/libvpx.git libvpx
cd libvpx
./configure \
    --prefix="$BUILD_DIR" \
    --disable-examples \
    --disable-unit-tests \
    --enable-vp9-highbitdepth \
    --as=yasm
make -j"$JOBS"
make install

# --------------------------------------------------------------- fdk-aac
log "libfdk-aac (AAC)"
cd "$SOURCES_DIR"
git_fetch https://github.com/mstorsjo/fdk-aac fdk-aac
cd fdk-aac
autoreconf -fiv
./configure --prefix="$BUILD_DIR" --disable-shared
make -j"$JOBS"
make install

# ------------------------------------------------------------------ lame
log "libmp3lame (MP3)"
cd "$SOURCES_DIR"
wget -nc "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz" || true
tar xzf "lame-$LAME_VERSION.tar.gz"
cd "lame-$LAME_VERSION"
./configure \
    --prefix="$BUILD_DIR" \
    --bindir="$BIN_DIR" \
    --disable-shared \
    --enable-nasm
make -j"$JOBS"
make install

# ------------------------------------------------------------------ opus
log "libopus"
cd "$SOURCES_DIR"
git_fetch https://github.com/xiph/opus.git opus
cd opus
./autogen.sh
./configure --prefix="$BUILD_DIR" --disable-shared
make -j"$JOBS"
make install

# ------------------------------------------------------------------- aom
log "libaom (AV1)"
cd "$SOURCES_DIR"
git_fetch https://aomedia.googlesource.com/aom aom
mkdir -p aom_build
cd aom_build
cmake -G "Unix Makefiles" \
    -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
    -DENABLE_TESTS=OFF \
    -DENABLE_NASM=on \
    -DBUILD_SHARED_LIBS=0 \
    ../aom
make -j"$JOBS"
make install

# ---------------------------------------------------------------- SVT-AV1
log "SVT-AV1"
cd "$SOURCES_DIR"
git_fetch https://gitlab.com/AOMediaCodec/SVT-AV1.git SVT-AV1
mkdir -p SVT-AV1/build
cd SVT-AV1/build
cmake -G "Unix Makefiles" \
    -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_DEC=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    ..
make -j"$JOBS"
make install

# ------------------------------------------------------------------ dav1d
log "libdav1d (декодер AV1)"
cd "$SOURCES_DIR"
git_fetch https://code.videolan.org/videolan/dav1d.git dav1d
mkdir -p dav1d/build
cd dav1d/build
meson setup \
    -Denable_tools=false \
    -Denable_tests=false \
    --default-library=static \
    .. \
    --prefix "$BUILD_DIR" \
    --libdir "$BUILD_DIR/lib" \
    --reconfigure 2> /dev/null \
    || meson setup \
        -Denable_tools=false \
        -Denable_tests=false \
        --default-library=static \
        .. \
        --prefix "$BUILD_DIR" \
        --libdir "$BUILD_DIR/lib"
ninja
ninja install

# ------------------------------------------------------------------ vvenc
# libvvenc (H.266/VVC) в apt нет — собираем из исходников
build_vvenc() {
    log "libvvenc (H.266/VVC)"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/fraunhoferhhi/vvenc.git vvenc v1.14.0
    rm -rf vvenc/build
    mkdir -p vvenc/build
    cd vvenc/build
    cmake -G "Unix Makefiles" \
        -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DVVENC_ENABLE_LINK_TIME_OPT=OFF \
        -DVVENC_INSTALL_FULLFEATURE_APP=OFF \
        ..
    make -j"$JOBS"
    make install
}

run_optional vvenc build_vvenc --enable-libvvenc

# --------------------------------------------------------------- kvazaar
# libkvazaar (H.265): версия в apt может быть < 2.0.0, а FFmpeg требует >= 2.0.0,
# поэтому собираем из исходников
build_kvazaar() {
    log "libkvazaar (H.265)"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/ultravideo/kvazaar.git kvazaar v2.3.2
    cd kvazaar
    ./autogen.sh
    ./configure --prefix="$BUILD_DIR" --disable-shared --enable-static
    make -j"$JOBS"
    make install
}

run_optional kvazaar build_kvazaar --enable-libkvazaar

# ---------------------------------------------------------------- vid.stab
build_vidstab() {
    log "vid.stab"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/georgmartius/vid.stab.git vid.stab
    rm -rf vid.stab/build
    mkdir -p vid.stab/build
    cd vid.stab/build
    cmake -G "Unix Makefiles" \
        -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DUSE_OMP=OFF \
        ..
    make -j"$JOBS"
    make install
}

run_optional vidstab build_vidstab --enable-libvidstab

# -------------------------------------------------------------------- SRT
build_srt() {
    log "SRT"
    cd "$SOURCES_DIR"
    git_fetch https://github.com/Haivision/srt.git srt
    rm -rf srt/build
    mkdir -p srt/build
    cd srt/build
    cmake -G "Unix Makefiles" \
        -DCMAKE_INSTALL_PREFIX="$BUILD_DIR" \
        -DCMAKE_BUILD_TYPE=Release \
        -DENABLE_SHARED=OFF \
        -DENABLE_STATIC=ON \
        -DENABLE_APPS=OFF \
        -DUSE_ENCLIB=openssl \
        ..
    make -j"$JOBS"
    make install
}

run_optional srt build_srt --enable-libsrt

# ----------------------------------------------------------------- ffmpeg
log "FFmpeg"
cd "$SOURCES_DIR"
# Берём исходники из git, а не из ffmpeg-snapshot.tar.bz2 (тот может отставать).
# release/9.0 = последняя 9.0.x; "master" = свежая разработка.
git_fetch https://git.ffmpeg.org/ffmpeg.git ffmpeg "$FFMPEG_REF"
cd ffmpeg
make distclean > /dev/null 2>&1 || true

FFMPEG_FLAGS=(
    --prefix="$BUILD_DIR"
    --pkg-config-flags="--static"
    --extra-cflags="-I$BUILD_DIR/include"
    --extra-ldflags="-L$BUILD_DIR/lib -static"
    --extra-libs="-lpthread -lm"
    --ld="g++"
    --bindir="$BIN_DIR"
    --enable-gpl
    --enable-version3
    --enable-openssl
    --enable-libaom
    --enable-libass
    --enable-libdav1d
    --enable-libfdk-aac
    --enable-libfreetype
    --enable-libmp3lame
    --enable-libopus
    --enable-libsvtav1
    --enable-libvorbis
    --enable-libvpx
    --enable-libx264
    --enable-libx265
    --enable-nonfree
    --disable-ffplay
    # VAAPI/VDPAU грузят драйверы через dlopen — в статическом бинарнике не работают
    --disable-vaapi
    --disable-vdpau
    # На случай, если SDL2/sndio остались в системе от прошлых сборок:
    # автоопределение подцепило бы их как динамические зависимости
    --disable-sdl2
    --disable-sndio
)

# Необязательные библиотеки, которые не подошли configure, отключаются
# автоматически (см. configure_ffmpeg) — сборка продолжится без них.
configure_ffmpeg "${OPTIONAL_FLAGS[@]}"

make -j"$JOBS"
make install
hash -r

# ----------------------------------------------------------------- done
log "Готово!"

# Проверка, что бинарники действительно статические
for bin in ffmpeg ffprobe; do
    [ -x "$BIN_DIR/$bin" ] || continue

    # ldd для статического файла завершается с кодом 1, а с pipefail это ломало
    # проверку в pipe (и set -e) — поэтому сначала забираем вывод целиком
    ldd_out="$(LC_ALL=C ldd "$BIN_DIR/$bin" 2>&1 || true)"

    if grep -qE "not a dynamic executable|statically linked" <<< "$ldd_out"; then
        echo "$bin: статический бинарник, внешние .so не нужны"
    else
        echo "ВНИМАНИЕ: $bin всё ещё динамический, зависимости:"
        awk '{ print "  " $0 }' <<< "$ldd_out"
    fi
done

"$BIN_DIR/ffmpeg" -version | head -n 1
if [ "${#FAILED_LIBS[@]}" -gt 0 ]; then
    echo "Не подключены (не собрались/не нашлись): ${FAILED_LIBS[*]}"
fi
echo
echo "Бинарники лежат в: $BIN_DIR"
echo "Если ~/bin нет в PATH, добавьте в ~/.bashrc:"
echo "    export PATH=\"$BIN_DIR:\$PATH\""
