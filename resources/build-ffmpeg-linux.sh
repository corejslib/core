# Вставить в build-ffmpeg-linux.sh после run_optional kvazaar ... (перед секцией "ffmpeg").
# Строки vidstab и srt из EXTRA_LIBS убрать, чтобы флаги --enable-* не дублировались.

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
