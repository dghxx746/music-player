/**
 * AuraFlow - 沉浸式音乐氛围播放器
 * Web Audio API + Canvas 可视化 + Cloudflare 云端音乐库
 */

// ==================== Anonymous User Identity ====================
const UserIdentity = {
  KEY: 'auraflow_user_id',
  PARAMS: ['sync', 'user_id'],
  PUBLIC_ID: 'public_library',

  getId() {
    try {
      localStorage.setItem(this.KEY, this.PUBLIC_ID);
      this.clearIncomingIdFromUrl();
      return this.PUBLIC_ID;
    } catch {
      return this.PUBLIC_ID;
    }
  },

  isValid(id) {
    return /^[a-zA-Z0-9_-]{8,80}$/.test(String(id || '').trim());
  },

  getIncomingId() {
    const params = new URLSearchParams(window.location.search);
    for (const name of this.PARAMS) {
      const value = params.get(name);
      if (this.isValid(value)) return value.trim();
    }
    return null;
  },

  clearIncomingIdFromUrl() {
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of this.PARAMS) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, document.title, url.toString());
    }
  },

  getShareUrl() {
    const url = new URL(window.location.href);
    for (const name of this.PARAMS) url.searchParams.delete(name);
    return url.toString();
  }
};

// ==================== Cloud API ====================
const CloudAPI = {
  BASE: '/api',
  available: null, // null = unknown, true/false

  userQuery() {
    return `user_id=${encodeURIComponent(UserIdentity.getId())}`;
  },

  url(path) {
    const separator = path.includes('?') ? '&' : '?';
    return `${this.BASE}${path}${separator}${this.userQuery()}`;
  },

  async checkAvailability() {
    if (this.available !== null) return this.available;
    try {
      const res = await fetch(this.url('/songs'), { method: 'GET', signal: AbortSignal.timeout(3000) });
      this.available = res.ok || res.status === 200;
    } catch {
      this.available = false;
    }
    return this.available;
  },

  async getSongs() {
    const res = await fetch(this.url('/songs'));
    if (!res.ok) throw new Error('获取歌曲列表失败');
    return res.json();
  },

  async upload(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', UserIdentity.getId());
    const res = await fetch(this.url('/upload'), { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '上传失败' }));
      throw new Error(err.error || '上传失败');
    }
    return res.json();
  },

  async updateSong(id, data) {
    try {
      const res = await fetch(this.url(`/songs/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async deleteSong(id) {
    const res = await fetch(this.url(`/songs/${encodeURIComponent(id)}`), { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '删除失败' }));
      throw new Error(err.error || '删除失败');
    }
    return res.json();
  },

  getStreamUrl(id) {
    return this.url(`/stream/${encodeURIComponent(id)}`);
  }
};

// ==================== Settings Persistence ====================
const Settings = {
  KEY: 'auraflow_settings',

  defaults() {
    return {
      volume: 0.75,
      isMuted: false,
      repeatMode: 'none',
      isShuffle: false,
      themeIndex: 0,
      vizModeIndex: 0,
      lastTrackId: null,
      lastPosition: 0,
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? { ...this.defaults(), ...JSON.parse(raw) } : this.defaults();
    } catch {
      return this.defaults();
    }
  },

  save(partial) {
    try {
      const current = this.load();
      const merged = { ...current, ...partial };
      localStorage.setItem(this.KEY, JSON.stringify(merged));
    } catch {}
  }
};

// ==================== Theme Colors ====================
const THEMES = [
  { name: '极光紫', accent: '#7c6ff7', secondary: '#ff6b9d', tertiary: '#4ecdc4', bg: [5, 5, 16] },
  { name: '落日橙', accent: '#ff8a50', secondary: '#ff5252', tertiary: '#ffd166', bg: [16, 8, 5] },
  { name: '深海蓝', accent: '#4ea8de', secondary: '#5e60ce', tertiary: '#48bfe3', bg: [5, 8, 20] },
  { name: '森林绿', accent: '#4ecdc4', secondary: '#44b09e', tertiary: '#a8e6cf', bg: [5, 16, 12] },
  { name: '樱花粉', accent: '#ff6b9d', secondary: '#c44569', tertiary: '#f78fb3', bg: [16, 5, 10] },
  { name: '星空金', accent: '#ffd166', secondary: '#ef476f', tertiary: '#118ab2', bg: [16, 14, 5] },
];

// ==================== Visualization Modes ====================
const VIZ_MODES = ['频谱柱', '无'];

// ==================== State ====================
const State = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  isShuffle: false,
  repeatMode: 'none',
  volume: 0.75,
  isMuted: false,
  themeIndex: 0,
  vizModeIndex: 0,
  vizMode: '频谱柱',
  audioContext: null,
  analyser: null,
  sourceNode: null,
  gainNode: null,
  currentAudio: null,
  currentLoadingAudio: null,
  isLoading: false,
  loadToken: 0,
  dataArray: null,
  freqArray: null,
  bufferLength: 0,
  animationId: null,
  particles: [],
  stars: [],
  mouse: { x: 0, y: 0 },
  bgImageUrl: null,
  _positionTimer: null,
};

// ==================== Audio Engine ====================
const AudioEngine = {
  init() {
    State.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    State.analyser = State.audioContext.createAnalyser();
    State.analyser.fftSize = 2048;
    State.analyser.smoothingTimeConstant = 0.85;
    State.bufferLength = State.analyser.frequencyBinCount;
    State.dataArray = new Uint8Array(State.bufferLength);
    State.freqArray = new Uint8Array(State.bufferLength);

    State.gainNode = State.audioContext.createGain();
    State.gainNode.gain.value = State.volume;
    State.gainNode.connect(State.audioContext.destination);
    State.analyser.connect(State.gainNode);
  },

  resumeContext() {
    if (State.audioContext && State.audioContext.state === 'suspended') {
      State.audioContext.resume();
    }
  },

  loadTrack(track, autoplay = false) {
    return new Promise((resolve, reject) => {
      const token = ++State.loadToken;
      State.isLoading = true;
      const stopAudio = (audio) => {
        if (!audio) return;
        try { audio.pause(); } catch {}
        try { audio.removeAttribute('src'); audio.load(); } catch {}
      };
      if (State.currentLoadingAudio) {
        stopAudio(State.currentLoadingAudio);
        State.currentLoadingAudio = null;
      }
      if (State.currentAudio) {
        this.savePosition();
        stopAudio(State.currentAudio);
        State.currentAudio = null;
      }
      if (State.sourceNode) {
        try { State.sourceNode.disconnect(); } catch(e) {}
        State.sourceNode = null;
      }

      const audio = new Audio();
      State.currentLoadingAudio = audio;
      audio.crossOrigin = 'anonymous';
      audio.src = track.url; // /api/stream/:id for cloud songs
      let sourceAttached = false;
      const attachAudio = () => {
        if (sourceAttached) return;
        sourceAttached = true;
        State.sourceNode = State.audioContext.createMediaElementSource(audio);
        State.sourceNode.connect(State.analyser);
        State.currentAudio = audio;
      };

      if (autoplay) {
        if (State.audioContext.state === 'suspended') {
          State.audioContext.resume();
        }
        attachAudio();
        State.currentLoadingAudio = null;
        State.isLoading = false;
        State.isPlaying = true;
        audio.play().catch(() => {
          State.isPlaying = false;
          UI.updatePlayButton();
        });
      }

      audio.addEventListener('canplaythrough', () => {
        if (token !== State.loadToken) {
          stopAudio(audio);
          reject(Object.assign(new Error('stale audio load'), { name: 'StaleLoadError' }));
          return;
        }
        if (State.audioContext.state === 'suspended') {
          State.audioContext.resume();
        }
        attachAudio();
        State.currentLoadingAudio = null;
        State.isLoading = false;
        resolve(audio);
      }, { once: true });

      audio.addEventListener('error', () => {
        if (token !== State.loadToken) {
          reject(Object.assign(new Error('stale audio load'), { name: 'StaleLoadError' }));
          return;
        }
        State.currentLoadingAudio = null;
        State.isLoading = false;
        reject(new Error('无法加载音频文件'));
      }, { once: true });

      audio.load();
    });
  },

  savePosition() {
    if (State.currentAudio && State.currentIndex >= 0) {
      const track = State.playlist[State.currentIndex];
      if (track && track.id) {
        const pos = State.currentAudio.currentTime;
        track.lastPosition = pos;
        CloudAPI.updateSong(track.id, { last_position: pos }).catch(() => {});
        Settings.save({ lastTrackId: track.id, lastPosition: pos });
      }
    }
  },

  play() {
    if (State.currentAudio) {
      this.resumeContext();
      State.currentAudio.play();
      State.isPlaying = true;
    }
  },

  pause() {
    if (State.currentAudio) {
      this.savePosition();
      State.currentAudio.pause();
      State.isPlaying = false;
    }
  },

  togglePlay() {
    if (State.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
    UI.updatePlayButton();
  },

  seek(ratio) {
    if (State.currentAudio && State.currentAudio.duration) {
      State.currentAudio.currentTime = ratio * State.currentAudio.duration;
    }
  },

  setVolume(val) {
    State.volume = val;
    if (State.gainNode) {
      State.gainNode.gain.value = State.isMuted ? 0 : val;
    }
    Settings.save({ volume: val });
  },

  toggleMute() {
    State.isMuted = !State.isMuted;
    if (State.gainNode) {
      State.gainNode.gain.value = State.isMuted ? 0 : State.volume;
    }
    Settings.save({ isMuted: State.isMuted });
  },

  getFrequencyData() {
    if (!State.analyser) return null;
    State.analyser.getByteFrequencyData(State.freqArray);
    return State.freqArray;
  },

  getTimeDomainData() {
    if (!State.analyser) return null;
    State.analyser.getByteTimeDomainData(State.dataArray);
    return State.dataArray;
  },

  getAverageFrequency() {
    const data = this.getFrequencyData();
    if (!data) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum / data.length;
  }
};

// ==================== Playlist Manager ====================
const Playlist = {
  guessType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', wma: 'audio/x-ms-wma' };
    return map[ext] || 'audio/unknown';
  },

  getFormatName(track) {
    const type = track.type || '';
    const map = {
      'audio/mpeg': 'MP3', 'audio/mp3': 'MP3', 'audio/wav': 'WAV', 'audio/wave': 'WAV',
      'audio/ogg': 'OGG', 'audio/flac': 'FLAC', 'audio/mp4': 'M4A', 'audio/aac': 'AAC',
      'audio/x-ms-wma': 'WMA',
    };
    for (const [key, val] of Object.entries(map)) {
      if (type.includes(key) || type === key) return val;
    }
    if (type.includes('mpeg')) return 'MP3';
    const name = track.name || '';
    const ext = name.split('.').pop().toUpperCase();
    return ext || '未知';
  },

  async addFiles(files) {
    const audioFiles = Array.from(files).filter(f =>
      f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac|wma)$/i.test(f.name)
    );
    if (audioFiles.length === 0) {
      UI.showToast('未找到支持的音频文件', 'error');
      return;
    }

    return this.addFilesFast(audioFiles);

    const wasEmpty = State.playlist.length === 0;
    let added = 0;
    let failed = 0;
    const cloudAvailable = await CloudAPI.checkAvailability();

    for (const file of audioFiles) {
      try {
        let track;
        if (cloudAvailable) {
          UI.showToast(`正在上传: ${file.name}...`, 'info');
          const result = await CloudAPI.upload(file);
          track = {
            id: result.id,
            name: result.name,
            url: CloudAPI.getStreamUrl(result.id),
            type: result.type || file.type || this.guessType(file.name),
            size: result.size || file.size,
            duration: 0,
            favorite: false,
            playCount: 0,
            lastPosition: 0,
            createdAt: new Date().toISOString(),
          };
        } else {
          // Local mode: use blob URL directly
          const id = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
          const url = URL.createObjectURL(file);
          track = {
            id,
            name: file.name.replace(/\.[^/.]+$/, ''),
            url,
            type: file.type || this.guessType(file.name),
            size: file.size,
            duration: 0,
            favorite: false,
            playCount: 0,
            lastPosition: 0,
            createdAt: new Date().toISOString(),
            _localBlob: file,
          };
        }

        State.playlist.unshift(track);
        added++;

        // Get duration
        const tempAudio = new Audio();
        tempAudio.src = track.url;
        tempAudio.addEventListener('loadedmetadata', () => {
          track.duration = tempAudio.duration;
          if (cloudAvailable && track.id && !track.id.startsWith('local_')) {
            CloudAPI.updateSong(track.id, { duration: tempAudio.duration }).catch(() => {});
          }
          UI.renderPlaylist();
        });
        tempAudio.addEventListener('error', () => {});
      } catch (e) {
        console.error('Add file failed:', file.name, e);
        failed++;
      }
    }

    UI.renderPlaylist();

    if (added > 0) {
      const mode = cloudAvailable ? '上传' : '加载';
      UI.showToast(`成功${mode} ${added} 首歌曲${failed > 0 ? `，${failed} 首失败` : ''}`, 'success');
    } else if (failed > 0) {
      UI.showToast('添加失败', 'error');
    }

    if (wasEmpty && State.playlist.length > 0) {
      State.currentIndex = 0;
      this.playCurrent();
    }
  },

  async addFilesFast(audioFiles) {
    const wasEmpty = State.playlist.length === 0;
    const newTracks = [];

    for (const file of audioFiles) {
      const id = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      const url = URL.createObjectURL(file);
      const track = {
        id,
        name: file.name.replace(/\.[^/.]+$/, ''),
        url,
        type: file.type || this.guessType(file.name),
        size: file.size,
        duration: 0,
        favorite: false,
        playCount: 0,
        lastPosition: 0,
        createdAt: new Date().toISOString(),
        _localBlob: file,
        _uploading: false,
        _uploadFailed: false,
      };

      State.playlist.unshift(track);
      newTracks.push(track);

      const tempAudio = new Audio();
      tempAudio.src = track.url;
      tempAudio.addEventListener('loadedmetadata', () => {
        track.duration = tempAudio.duration;
        if (track.id && !track.id.startsWith('local_')) {
          CloudAPI.updateSong(track.id, { duration: track.duration }).catch(() => {});
        }
        UI.renderPlaylist();
      });
      tempAudio.addEventListener('error', () => {});
    }

    UI.renderPlaylist();
    UI.showToast(`已添加 ${newTracks.length} 首歌曲`, 'success');

    if (wasEmpty && State.playlist.length > 0) {
      State.currentIndex = 0;
      this.playCurrent();
    }

    this.uploadLocalTracksInBackground(newTracks);
  },

  async uploadLocalTracksInBackground(tracks) {
    const cloudAvailable = await CloudAPI.checkAvailability();
    if (!cloudAvailable) return;

    let uploaded = 0;
    let failed = 0;

    for (const track of tracks) {
      if (!track._localBlob || !track.id.startsWith('local_')) continue;

      track._uploading = true;
      track._uploadFailed = false;
      UI.renderPlaylist();

      try {
        const result = await CloudAPI.upload(track._localBlob);
        track.id = result.id;
        track.name = result.name || track.name;
        track.url = CloudAPI.getStreamUrl(result.id);
        track.type = result.type || track.type;
        track.size = result.size || track.size;
        track._uploading = false;
        track._uploaded = true;
        uploaded++;

        if (track.duration) {
          CloudAPI.updateSong(track.id, { duration: track.duration }).catch(() => {});
        }
      } catch (e) {
        console.error('Background upload failed:', track.name, e);
        track._uploading = false;
        track._uploadFailed = true;
        failed++;
      }

      UI.renderPlaylist();
    }

    if (uploaded > 0 && failed === 0) {
      UI.showToast(`已同步 ${uploaded} 首歌曲到云端`, 'success');
    } else if (uploaded > 0 || failed > 0) {
      UI.showToast(`云端同步完成：${uploaded} 成功，${failed} 失败`, failed > 0 ? 'error' : 'success');
    }
  },

  async restoreFromCloud() {
    const cloudAvailable = await CloudAPI.checkAvailability();

    if (!cloudAvailable) {
      UI.showToast('本地模式 - 拖拽音乐文件开始播放', 'info');
      return;
    }

    try {
      UI.showToast('正在加载云端音乐库...', 'info');
      const songs = await CloudAPI.getSongs();

      if (songs.length === 0) {
        UI.showToast('云端音乐库为空，拖拽音乐文件开始上传', 'info');
        return;
      }

      for (const song of songs) {
        State.playlist.push({
          id: song.id,
          name: song.name,
          url: CloudAPI.getStreamUrl(song.id),
          type: song.type || '',
          size: song.size || 0,
          duration: song.duration || 0,
          favorite: !!song.favorite,
          playCount: song.play_count || 0,
          lastPosition: song.last_position || 0,
          createdAt: song.created_at,
        });
      }

      UI.renderPlaylist();
      UI.showToast(`已加载 ${songs.length} 首云端歌曲`, 'success');

      // Restore last playing track
      const settings = Settings.load();
      if (settings.lastTrackId) {
        const idx = State.playlist.findIndex(t => t.id === settings.lastTrackId);
        if (idx >= 0) {
          State.currentIndex = idx;
          const track = State.playlist[idx];
          try {
            await AudioEngine.loadTrack(track);
            if (settings.lastPosition > 0 && settings.lastPosition < (track.duration || 0) - 2) {
              State.currentAudio.currentTime = settings.lastPosition;
            }
            UI.updateTrackInfo(track);
            UI.renderPlaylist();
            UI.updateTrackDetail(track);
            UI.updateProgress();
          } catch (e) {
            console.error('Restore track failed:', e);
          }
        }
      }
    } catch (e) {
      console.error('Restore from cloud failed:', e);
      UI.showToast('加载云端音乐库失败: ' + e.message, 'error');
    }
  },

  async playCurrent() {
    if (State.currentIndex < 0 || State.currentIndex >= State.playlist.length) return;

    const track = State.playlist[State.currentIndex];
    try {
      await AudioEngine.loadTrack(track, true);
      AudioEngine.play();

      // Update metadata
      track.lastPlayedAt = Date.now();
      track.playCount = (track.playCount || 0) + 1;
      if (track.id) {
        CloudAPI.updateSong(track.id, {
          play_count: track.playCount,
        }).catch(() => {});
        Settings.save({ lastTrackId: track.id });
      }

      UI.updatePlayButton();
      UI.updateTrackInfo(track);
      UI.renderPlaylist();
      UI.updateProgress();
      UI.updateTrackDetail(track);
      Visualizer.start();
    } catch (e) {
      console.error('播放失败:', e);
      UI.showToast('播放失败: ' + e.message, 'error');
    }
  },

  next() {
    if (State.playlist.length === 0) return;
    AudioEngine.savePosition();
    if (State.isShuffle) {
      State.currentIndex = Math.floor(Math.random() * State.playlist.length);
    } else {
      State.currentIndex = (State.currentIndex + 1) % State.playlist.length;
    }
    this.playCurrent();
  },

  prev() {
    if (State.playlist.length === 0) return;
    AudioEngine.savePosition();
    if (State.currentAudio && State.currentAudio.currentTime > 3) {
      State.currentAudio.currentTime = 0;
      return;
    }
    if (State.isShuffle) {
      State.currentIndex = Math.floor(Math.random() * State.playlist.length);
    } else {
      State.currentIndex = (State.currentIndex - 1 + State.playlist.length) % State.playlist.length;
    }
    this.playCurrent();
  },

  // Play mode cycle: sequential → repeat-one → repeat-all → shuffle
  cyclePlayMode() {
    // Order: sequential (none, !shuffle) → repeat-one (one, !shuffle) → repeat-all (all, !shuffle) → shuffle (!repeat, shuffle)
    if (!State.isShuffle && State.repeatMode === 'none') {
      State.repeatMode = 'one';
      State.isShuffle = false;
    } else if (!State.isShuffle && State.repeatMode === 'one') {
      State.repeatMode = 'all';
      State.isShuffle = false;
    } else if (!State.isShuffle && State.repeatMode === 'all') {
      State.repeatMode = 'none';
      State.isShuffle = true;
    } else {
      State.repeatMode = 'none';
      State.isShuffle = false;
    }
    Settings.save({ repeatMode: State.repeatMode, isShuffle: State.isShuffle });
  },

  async removeTrack(index) {
    if (index < 0 || index >= State.playlist.length) return;
    const track = State.playlist[index];

    if (index === State.currentIndex) {
      if (State.currentAudio) {
        State.currentAudio.pause();
        State.currentAudio = null;
      }
      State.isPlaying = false;
    }

    // Revoke local blob URL if applicable
    if (track._localBlob && track.url) {
      try { URL.revokeObjectURL(track.url); } catch {}
    }

    // Delete from cloud (skip for local tracks)
    if (track.id && !track.id.startsWith('local_')) {
      try {
        await CloudAPI.deleteSong(track.id);
      } catch (e) {
        UI.showToast('删除失败: ' + e.message, 'error');
        return;
      }
    }

    State.playlist.splice(index, 1);

    if (index === State.currentIndex) {
      if (State.playlist.length > 0) {
        State.currentIndex = index % State.playlist.length;
        this.playCurrent();
      } else {
        State.currentIndex = -1;
        UI.resetToDefault();
      }
    } else {
      if (index < State.currentIndex) State.currentIndex--;
    }

    UI.renderPlaylist();
    UI.showToast('歌曲已删除', 'success');
  },

  async clearLibrary() {
    if (State.playlist.length === 0) {
      UI.showToast('音乐库已经是空的', 'info');
      return;
    }

    if (State.currentAudio) {
      AudioEngine.savePosition();
      State.currentAudio.pause();
      State.currentAudio.src = '';
      State.currentAudio = null;
    }
    State.isPlaying = false;

    const failed = [];

    for (const track of State.playlist) {
      if (track.id && !track.id.startsWith('local_')) {
        try {
          await CloudAPI.deleteSong(track.id);
        } catch (e) {
          console.error('Clear song failed:', track.name, e);
          failed.push(track);
          continue;
        }
      }

      if (track._localBlob && track.url) {
        try { URL.revokeObjectURL(track.url); } catch {}
      }
    }

    State.playlist = failed;
    State.currentIndex = -1;
    Settings.save({ lastTrackId: null, lastPosition: 0 });
    UI.resetToDefault();
    UI.renderPlaylist();

    if (failed.length > 0) {
      UI.showToast(`部分歌曲删除失败，剩余 ${failed.length} 首`, 'error');
    } else {
      UI.showToast('音乐库已清空', 'success');
    }
  },

  async toggleFavorite(index) {
    if (index < 0 || index >= State.playlist.length) return;
    const track = State.playlist[index];
    track.favorite = !track.favorite;

    if (track.id) {
      try {
        await CloudAPI.updateSong(track.id, { favorite: track.favorite ? 1 : 0 });
      } catch (e) {
        track.favorite = !track.favorite; // revert
        UI.showToast('收藏操作失败', 'error');
        return;
      }
    }

    UI.renderPlaylist();
    if (index === State.currentIndex) {
      UI.updateTrackDetail(track);
    }
  },

  onTrackEnd() {
    AudioEngine.savePosition();
    if (State.repeatMode === 'one') {
      State.currentAudio.currentTime = 0;
      AudioEngine.play();
    } else if (State.repeatMode === 'all' || State.currentIndex < State.playlist.length - 1) {
      this.next();
    } else {
      State.isPlaying = false;
      UI.updatePlayButton();
    }
  },

  playTrackAt(index) {
    if (index >= 0 && index < State.playlist.length) {
      AudioEngine.savePosition();
      State.currentIndex = index;
      this.playCurrent();
    }
  }
};

// ==================== Visualizer ====================
const Visualizer = {
  bgCanvas: null,
  bgCtx: null,
  vizCanvas: null,
  vizCtx: null,
  width: 0,
  height: 0,

  init() {
    this.bgCanvas = document.getElementById('bgCanvas');
    this.bgCtx = this.bgCanvas.getContext('2d');
    this.vizCanvas = document.getElementById('vizCanvas');
    this.vizCtx = this.vizCanvas.getContext('2d');

    this.resize();
    window.addEventListener('resize', () => this.resize());

    for (let i = 0; i < 150; i++) {
      State.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 2 + 0.5,
        speed: Math.random() * 0.3 + 0.05,
        opacity: Math.random() * 0.8 + 0.2,
      });
    }

    this.animate();
  },

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    for (const canvas of [this.bgCanvas, this.vizCanvas]) {
      canvas.width = this.width * dpr;
      canvas.height = this.height * dpr;
      canvas.style.width = this.width + 'px';
      canvas.style.height = this.height + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
    }
  },

  start() {},

  animate() {
    State.animationId = requestAnimationFrame(() => this.animate());

    const theme = THEMES[State.themeIndex];
    const avgFreq = AudioEngine.getAverageFrequency();
    const normalizedAvg = avgFreq / 255;

    this.drawBackground(theme, normalizedAvg);
    this.vizCtx.clearRect(0, 0, this.width, this.height);

    switch (State.vizMode) {
      case '波形': this.drawWaveform(theme); break;
      case '频谱柱': this.drawBars(theme); break;
      case '环形': this.drawCircular(theme, normalizedAvg); break;
      case '粒子': this.drawParticles(theme, normalizedAvg); break;
      case '星云': this.drawNebula(theme, normalizedAvg); break;
    }
  },

  drawBackground(theme, energy) {
    const ctx = this.bgCtx;
    const [r, g, b] = theme.bg;

    const grad = ctx.createRadialGradient(
      this.width / 2, this.height / 2, 0,
      this.width / 2, this.height / 2, this.width * 0.7
    );

    const glowIntensity = Math.min(0.15, energy * 0.3);
    const accentR = parseInt(theme.accent.slice(1, 3), 16);
    const accentG = parseInt(theme.accent.slice(3, 5), 16);
    const accentB = parseInt(theme.accent.slice(5, 7), 16);

    grad.addColorStop(0, `rgba(${accentR}, ${accentG}, ${accentB}, ${glowIntensity})`);
    grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.3)`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.95)`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    for (const star of State.stars) {
      star.x += star.speed * (0.5 + energy);
      if (star.x > this.width) { star.x = 0; star.y = Math.random() * this.height; }

      const twinkle = 0.5 + Math.sin(Date.now() * 0.001 + star.x) * 0.5;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size * (0.8 + energy * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity * twinkle * (0.3 + energy * 0.7)})`;
      ctx.fill();
    }
  },

  drawWaveform(theme) {
    const ctx = this.vizCtx;
    const data = AudioEngine.getTimeDomainData();
    if (!data) return;

    const sliceWidth = this.width / State.bufferLength;

    for (let layer = 2; layer >= 0; layer--) {
      ctx.beginPath();
      ctx.lineWidth = 3 - layer;
      const alpha = 0.3 + layer * 0.3;
      const colors = [theme.accent, theme.secondary, theme.tertiary];
      ctx.strokeStyle = colors[layer] + Math.round(alpha * 255).toString(16).padStart(2, '0');

      let x = 0;
      for (let i = 0; i < State.bufferLength; i++) {
        const v = data[i] / 128.0;
        const y = (v * this.height / 2) + (layer - 1) * 20;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();
      ctx.shadowColor = colors[layer];
      ctx.shadowBlur = 10 + layer * 5;
    }
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.scale(1, -1);
    ctx.translate(0, -this.height);
    for (let layer = 2; layer >= 0; layer--) {
      ctx.beginPath();
      ctx.lineWidth = 2 - layer;
      ctx.strokeStyle = theme.accent;
      let x = 0;
      for (let i = 0; i < State.bufferLength; i++) {
        const v = data[i] / 128.0;
        const y = (v * this.height / 2) + (layer - 1) * 20;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();
    }
    ctx.restore();
  },

  drawBars(theme) {
    const ctx = this.vizCtx;
    const data = AudioEngine.getFrequencyData();
    if (!data) return;

    const barCount = 64;
    const pairCount = barCount / 2;
    const gap = 3;
    const visualWidth = Math.min(this.width * 0.88, 760);
    const totalGap = gap * (barCount - 1);
    const barWidth = Math.max(2, (visualWidth - totalGap) / barCount);
    const totalWidth = barWidth * barCount + totalGap;
    const centerX = this.width / 2;
    const startX = centerX - totalWidth / 2;
    const step = Math.max(1, Math.floor(State.bufferLength / pairCount));

    const drawBar = (x, value, t) => {
      const barHeight = value * this.height * 0.65;
      const y = this.height - barHeight;

      const grad = ctx.createLinearGradient(x, this.height, x, y);
      if (t < 0.33) { grad.addColorStop(0, theme.accent); grad.addColorStop(1, theme.secondary); }
      else if (t < 0.66) { grad.addColorStop(0, theme.secondary); grad.addColorStop(1, theme.tertiary); }
      else { grad.addColorStop(0, theme.tertiary); grad.addColorStop(1, theme.accent); }

      ctx.fillStyle = grad;
      const radius = Math.min(barWidth / 2, 4);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barWidth - radius, y);
      ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
      ctx.lineTo(x + barWidth, this.height);
      ctx.lineTo(x, this.height);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.fill();

      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = value * 15;

      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.scale(1, -1);
      ctx.translate(0, -this.height * 2 + barHeight);
      ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
    };

    for (let i = 0; i < pairCount; i++) {
      const value = data[i * step] / 255;
      const rightIndex = pairCount + i;
      const leftIndex = pairCount - 1 - i;
      const rightX = startX + rightIndex * (barWidth + gap);
      const leftX = startX + leftIndex * (barWidth + gap);
      const t = i / pairCount;

      drawBar(leftX, value, t);
      drawBar(rightX, value, t);
    }
  },

  drawCircular(theme, energy) {
    const ctx = this.vizCtx;
    const data = AudioEngine.getFrequencyData();
    if (!data) return;

    const cx = this.width / 2;
    const cy = this.height / 2;
    const baseRadius = Math.min(this.width, this.height) * 0.18;
    const maxRadius = Math.min(this.width, this.height) * 0.38;
    const step = Math.floor(State.bufferLength / 128);

    for (let ring = 0; ring < 3; ring++) {
      ctx.beginPath();
      const ringRadius = baseRadius + ring * 20;
      for (let i = 0; i <= 128; i++) {
        const idx = i % 128;
        const value = data[idx * step] / 255;
        const angle = (idx / 128) * Math.PI * 2 - Math.PI / 2;
        const r = ringRadius + value * (maxRadius - baseRadius) * (1 - ring * 0.3);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const colors = [theme.accent, theme.secondary, theme.tertiary];
      ctx.strokeStyle = colors[ring];
      ctx.lineWidth = 2 - ring * 0.5;
      ctx.globalAlpha = 0.8 - ring * 0.2;
      ctx.shadowColor = colors[ring];
      ctx.shadowBlur = 10 + energy * 20;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
    centerGrad.addColorStop(0, theme.accent + '33');
    centerGrad.addColorStop(0.7, theme.accent + '11');
    centerGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = centerGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius + energy * 20, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 128; i += 2) {
      const value = data[i * step] / 255;
      const angle = (i / 128) * Math.PI * 2 - Math.PI / 2;
      const r = baseRadius - 10;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + value * 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.2 + value * 0.6})`;
      ctx.fill();
    }
  },

  drawParticles(theme, energy) {
    const ctx = this.vizCtx;
    const data = AudioEngine.getFrequencyData();

    if (energy > 0.1) {
      const spawnCount = Math.floor(energy * 5) + 1;
      for (let i = 0; i < spawnCount; i++) {
        if (State.particles.length > 300) break;
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.5 + energy * 3;
        const colors = [theme.accent, theme.secondary, theme.tertiary];
        State.particles.push({
          x: this.width / 2 + (Math.random() - 0.5) * 100,
          y: this.height / 2 + (Math.random() - 0.5) * 100,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: Math.random() * 4 + 1,
          life: 1,
          decay: 0.005 + Math.random() * 0.01,
          color: colors[Math.floor(Math.random() * 3)],
        });
      }
    }

    for (let i = State.particles.length - 1; i >= 0; i--) {
      const p = State.particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.99; p.vy *= 0.99;
      p.life -= p.decay;

      if (p.life <= 0) { State.particles.splice(i, 1); continue; }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.round(p.life * 200).toString(16).padStart(2, '0');
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.size * 3 * p.life;
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (data) {
      const cx = this.width / 2;
      const cy = this.height / 2;
      const pulseR = 30 + energy * 80;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
      grad.addColorStop(0, theme.accent + '44');
      grad.addColorStop(0.5, theme.secondary + '22');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawNebula(theme, energy) {
    const ctx = this.vizCtx;
    const data = AudioEngine.getFrequencyData();
    if (!data) return;

    const cx = this.width / 2;
    const cy = this.height / 2;
    const step = Math.floor(State.bufferLength / 60);

    for (let i = 0; i < 60; i++) {
      const value = data[i * step] / 255;
      const angle = (i / 60) * Math.PI * 2 + Date.now() * 0.0002;
      const baseR = 80 + i * 2;
      const r = baseR + value * 120;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const size = 20 + value * 60;

      const colors = [theme.accent, theme.secondary, theme.tertiary];
      const color = colors[i % 3];
      const hexR = parseInt(color.slice(1, 3), 16);
      const hexG = parseInt(color.slice(3, 5), 16);
      const hexB = parseInt(color.slice(5, 7), 16);

      const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
      grad.addColorStop(0, `rgba(${hexR}, ${hexG}, ${hexB}, ${0.15 + value * 0.2})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    const glowR = 60 + energy * 100;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    glow.addColorStop(0, theme.accent + '33');
    glow.addColorStop(0.4, theme.secondary + '11');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();
  }
};

// ==================== UI Controller ====================
const UI = {
  _toastTimeout: null,

  async init() {
    this.bindEvents();
    await this.restoreSettings();
    await Playlist.restoreFromCloud();
    this.updateTheme();
  },

  createSyncControls() {
    if (!document.getElementById('syncBtn')) {
      const actions = document.querySelector('.header-actions');
      const themeBtn = document.getElementById('themeBtn');
      const btn = document.createElement('button');
      btn.id = 'syncBtn';
      btn.className = 'icon-btn';
      btn.title = '同步到手机';
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
          <line x1="12" y1="18" x2="12.01" y2="18"></line>
          <path d="M9 7h6M9 11h6"></path>
        </svg>
      `;
      actions?.insertBefore(btn, themeBtn || null);
    }

    if (!document.getElementById('syncModal')) {
      const modal = document.createElement('div');
      modal.id = 'syncModal';
      modal.className = 'sync-modal hidden';
      modal.innerHTML = `
        <div class="sync-dialog glass-card">
          <button id="syncCloseBtn" class="sync-close" title="关闭">×</button>
          <h3>同步到手机</h3>
          <img id="syncQrImage" class="sync-qr" alt="同步二维码" />
          <input id="syncLinkInput" class="sync-link-input" readonly />
          <button id="syncCopyBtn" class="small-btn glow-btn">复制链接</button>
        </div>
      `;
      document.body.appendChild(modal);
    }
  },

  async restoreSettings() {
    const s = Settings.load();
    State.volume = s.volume;
    State.isMuted = s.isMuted;
    State.repeatMode = s.repeatMode;
    State.isShuffle = s.isShuffle;
    State.themeIndex = s.themeIndex;
    State.vizModeIndex = s.vizModeIndex;
    State.vizMode = VIZ_MODES[s.vizModeIndex] || '频谱柱';

    document.getElementById('volumeSlider').value = State.volume * 100;
    document.getElementById('vizModeLabel').textContent = State.vizMode;

    this.updatePlayModeButton();
    this.updateVolumeIcon();
  },

  bindEvents() {
    // Playback controls
    document.getElementById('playBtn').addEventListener('click', () => {
      AudioEngine.resumeContext();
      if (State.playlist.length === 0) {
        document.getElementById('fileInput').click();
        return;
      }
      if (State.currentAudio) {
        AudioEngine.togglePlay();
      } else {
        Playlist.playCurrent();
      }
    });

    document.getElementById('prevBtn').addEventListener('click', () => Playlist.prev());
    document.getElementById('nextBtn').addEventListener('click', () => Playlist.next());

    // Play mode cycle button: sequential → repeat-one → repeat-all → shuffle
    document.getElementById('playModeBtn').addEventListener('click', () => {
      Playlist.cyclePlayMode();
      this.updatePlayModeButton();
    });

    // Volume
    document.getElementById('volumeSlider').addEventListener('input', (e) => {
      AudioEngine.setVolume(e.target.value / 100);
      this.updateVolumeIcon();
    });

    document.getElementById('muteBtn').addEventListener('click', () => {
      AudioEngine.toggleMute();
      this.updateVolumeIcon();
    });

    // Progress bar
    const progressBar = document.getElementById('progressBar');
    let isSeeking = false;

    const seekFromEvent = (e) => {
      const rect = progressBar.querySelector('.progress-track').getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      AudioEngine.seek(ratio);
    };

    progressBar.addEventListener('mousedown', (e) => {
      isSeeking = true;
      seekFromEvent(e);
    });
    document.addEventListener('mousemove', (e) => { if (isSeeking) seekFromEvent(e); });
    document.addEventListener('mouseup', () => { isSeeking = false; });

    // Viz mode
    document.getElementById('vizModeBtn').addEventListener('click', () => {
      State.vizModeIndex = (State.vizModeIndex + 1) % VIZ_MODES.length;
      State.vizMode = VIZ_MODES[State.vizModeIndex];
      document.getElementById('vizModeLabel').textContent = State.vizMode;
      Settings.save({ vizModeIndex: State.vizModeIndex });
    });

    // Theme
    document.getElementById('themeBtn').addEventListener('click', () => {
      State.themeIndex = (State.themeIndex + 1) % THEMES.length;
      this.updateTheme();
      Settings.save({ themeIndex: State.themeIndex });
    });

    document.getElementById('syncBtn')?.addEventListener('click', () => {
      this.showSyncModal();
    });

    document.getElementById('syncCloseBtn')?.addEventListener('click', () => {
      this.hideSyncModal();
    });

    document.getElementById('syncModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'syncModal') this.hideSyncModal();
    });

    document.getElementById('syncCopyBtn')?.addEventListener('click', () => {
      this.copySyncLink();
    });

    // File input
    document.getElementById('addFilesBtn').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        Playlist.addFiles(e.target.files);
        e.target.value = '';
      }
    });

    document.getElementById('clearLibraryBtn')?.addEventListener('click', () => {
      if (State.playlist.length === 0) {
        UI.showToast('音乐库已经是空的', 'info');
        return;
      }
      const confirmed = window.confirm('确定要清空音乐库吗？云端歌曲会从 R2 和 D1 中删除。');
      if (confirmed) Playlist.clearLibrary();
    });

    // Background image upload
    document.getElementById('bgUploadBtn').addEventListener('click', () => {
      document.getElementById('bgImageInput').click();
    });

    document.getElementById('bgImageInput').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const url = URL.createObjectURL(file);
        State.bgImageUrl = url;
        const layer = document.getElementById('bgImageLayer');
        layer.style.backgroundImage = `url(${url})`;
        layer.classList.add('has-image');
        document.getElementById('bgClearBtn').classList.remove('hidden');
        e.target.value = '';
      }
    });

    document.getElementById('bgClearBtn').addEventListener('click', () => {
      State.bgImageUrl = null;
      const layer = document.getElementById('bgImageLayer');
      layer.style.backgroundImage = '';
      layer.classList.remove('has-image');
      document.getElementById('bgClearBtn').classList.add('hidden');
    });

    // Mobile playlist toggle
    const mobilePlaylistBtn = document.getElementById('mobilePlaylistBtn');
    const mobileBackdrop = document.getElementById('mobilePlaylistBackdrop');
    const panelLeft = document.querySelector('.panel-left');

    function openMobilePlaylist() {
      panelLeft?.classList.add('mobile-open');
      mobileBackdrop?.classList.add('show');
    }

    function closeMobilePlaylist() {
      panelLeft?.classList.remove('mobile-open');
      mobileBackdrop?.classList.remove('show');
    }

    mobilePlaylistBtn?.addEventListener('click', () => {
      if (panelLeft?.classList.contains('mobile-open')) {
        closeMobilePlaylist();
      } else {
        openMobilePlaylist();
      }
    });

    mobileBackdrop?.addEventListener('click', () => {
      closeMobilePlaylist();
    });

    document.addEventListener('pointerdown', (e) => {
      if (!panelLeft?.classList.contains('mobile-open')) return;
      const target = e.target;
      if (panelLeft.contains(target) || mobilePlaylistBtn?.contains(target)) return;
      closeMobilePlaylist();
    });

    // Touch: swipe from left edge to open playlist
    let touchStartX = 0;
    document.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const diffX = touchEndX - touchStartX;
      if (touchStartX < 30 && diffX > 80) {
        openMobilePlaylist();
      } else if (panelLeft?.classList.contains('mobile-open') && diffX < -80) {
        closeMobilePlaylist();
      }
    }, { passive: true });

    // Drag & Drop
    const dragOverlay = document.getElementById('dragOverlay');
    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) dragOverlay.classList.remove('hidden');
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) dragOverlay.classList.add('hidden');
    });

    document.addEventListener('dragover', (e) => { e.preventDefault(); });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dragOverlay.classList.add('hidden');
      if (e.dataTransfer.files.length > 0) {
        Playlist.addFiles(e.dataTransfer.files);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          AudioEngine.togglePlay();
          break;
        case 'ArrowRight':
          if (e.ctrlKey) Playlist.next();
          else if (State.currentAudio) State.currentAudio.currentTime += 5;
          break;
        case 'ArrowLeft':
          if (e.ctrlKey) Playlist.prev();
          else if (State.currentAudio) State.currentAudio.currentTime -= 5;
          break;
        case 'ArrowUp':
          e.preventDefault();
          State.volume = Math.min(1, State.volume + 0.05);
          AudioEngine.setVolume(State.volume);
          document.getElementById('volumeSlider').value = State.volume * 100;
          this.updateVolumeIcon();
          break;
        case 'ArrowDown':
          e.preventDefault();
          State.volume = Math.max(0, State.volume - 0.05);
          AudioEngine.setVolume(State.volume);
          document.getElementById('volumeSlider').value = State.volume * 100;
          this.updateVolumeIcon();
          break;
        case 'KeyM':
          AudioEngine.toggleMute();
          this.updateVolumeIcon();
          break;
      }
    });

    document.addEventListener('mousemove', (e) => {
      State.mouse.x = e.clientX;
      State.mouse.y = e.clientY;
    });

    // Save position periodically (every 5 seconds)
    State._positionTimer = setInterval(() => {
      if (State.isPlaying && State.currentAudio) {
        AudioEngine.savePosition();
      }
    }, 5000);

    // Save position before unload
    window.addEventListener('beforeunload', () => {
      AudioEngine.savePosition();
    });
  },

  showSyncModal() {
    const link = UserIdentity.getShareUrl();
    const modal = document.getElementById('syncModal');
    const input = document.getElementById('syncLinkInput');
    const qr = document.getElementById('syncQrImage');

    if (input) input.value = link;
    if (qr) {
      qr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=' + encodeURIComponent(link);
    }
    modal?.classList.remove('hidden');
    this.copySyncLink(false);
  },

  hideSyncModal() {
    document.getElementById('syncModal')?.classList.add('hidden');
  },

  async copySyncLink(showResult = true) {
    const link = UserIdentity.getShareUrl();
    const input = document.getElementById('syncLinkInput');
    if (input) input.value = link;

    try {
      await navigator.clipboard.writeText(link);
      if (showResult) this.showToast('同步链接已复制', 'success');
    } catch {
      input?.select();
      if (showResult) this.showToast('可手动复制同步链接', 'info');
    }
  },

  showToast(message, type = 'info') {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification toast-' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  updatePlayButton() {
    const playIcon = document.querySelector('.play-icon');
    const pauseIcon = document.querySelector('.pause-icon');
    const disc = document.getElementById('coverDisc');

    if (State.isPlaying) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
      disc.classList.add('spinning');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
      disc.classList.remove('spinning');
    }
  },

  updatePlayModeButton() {
    const btn = document.getElementById('playModeBtn');
    const icons = {
      sequential: btn.querySelector('.pm-sequential'),
      repeatOne: btn.querySelector('.pm-repeat-one'),
      repeatAll: btn.querySelector('.pm-repeat-all'),
      shuffle: btn.querySelector('.pm-shuffle'),
    };

    // Hide all icons first
    Object.values(icons).forEach(el => el?.classList.add('hidden'));

    if (State.isShuffle) {
      icons.shuffle?.classList.remove('hidden');
      btn.title = '随机播放';
      btn.classList.add('active');
    } else if (State.repeatMode === 'one') {
      icons.repeatOne?.classList.remove('hidden');
      btn.title = '单曲循环';
      btn.classList.add('active');
    } else if (State.repeatMode === 'all') {
      icons.repeatAll?.classList.remove('hidden');
      btn.title = '列表循环';
      btn.classList.add('active');
    } else {
      icons.sequential?.classList.remove('hidden');
      btn.title = '顺序播放';
      btn.classList.remove('active');
    }
  },

  updateTrackInfo(track) {
    document.getElementById('headerTrackName').textContent = track.name;
    document.title = `${track.name} - AuraFlow`;
  },

  updateTrackDetail(track) {
    const container = document.getElementById('trackDetail');
    const format = Playlist.getFormatName(track);
    const duration = track.duration ? this.formatTime(track.duration) : '--:--';
    const size = track.size ? this.formatFileSize(track.size) : '--';
    const playCount = track.playCount || 0;
    const lastPlayed = track.lastPlayedAt ? new Date(track.lastPlayedAt).toLocaleString('zh-CN') : '从未播放';
    const favIcon = track.favorite ? '★' : '☆';
    const favClass = track.favorite ? 'favorited' : '';

    container.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">曲名</span>
        <span class="detail-value">${track.name}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">格式</span>
        <span class="detail-value">${format}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">时长</span>
        <span class="detail-value detail-duration">${duration}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">文件大小</span>
        <span class="detail-value">${size}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">播放次数</span>
        <span class="detail-value">${playCount}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">上次播放</span>
        <span class="detail-value" style="font-size:11px;">${lastPlayed}</span>
      </div>
      <div class="detail-row detail-row-action">
        <span class="detail-label">收藏</span>
        <button class="fav-btn ${favClass}" data-fav-index="${State.currentIndex}">${favIcon}</button>
      </div>
    `;

    container.querySelector('.fav-btn')?.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.favIndex);
      Playlist.toggleFavorite(idx);
    });
  },

  resetToDefault() {
    document.getElementById('headerTrackName').textContent = '未在播放';
    document.title = 'AuraFlow - 音乐氛围播放器';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressThumb').style.left = '0%';
    document.getElementById('currentTime').textContent = '0:00';
    document.getElementById('totalTime').textContent = '0:00';
    document.getElementById('trackDetail').innerHTML = `
      <div class="detail-empty">
        <p>暂无音乐信息</p>
        <p class="sub">选择一首歌曲开始播放</p>
      </div>
    `;
    this.updatePlayButton();
  },

  updateProgress() {
    if (!State.currentAudio) return;

    const update = () => {
      if (!State.currentAudio) return;
      const current = State.currentAudio.currentTime;
      const duration = State.currentAudio.duration || 0;
      const ratio = duration ? (current / duration) * 100 : 0;

      document.getElementById('progressFill').style.width = ratio + '%';
      document.getElementById('progressThumb').style.left = ratio + '%';
      document.getElementById('currentTime').textContent = this.formatTime(current);
      document.getElementById('totalTime').textContent = this.formatTime(duration);

      const detailDurationEl = document.querySelector('.detail-duration');
      if (detailDurationEl) {
        detailDurationEl.textContent = `${this.formatTime(current)} / ${this.formatTime(duration)}`;
      }

      requestAnimationFrame(update);
    };
    update();

    State.currentAudio.addEventListener('ended', () => {
      Playlist.onTrackEnd();
    });
  },

  renderPlaylist() {
    const container = document.getElementById('playlistItems');

    if (State.playlist.length === 0) {
      container.innerHTML = `
        <div class="playlist-empty">
          <p>拖拽音乐文件到此处</p>
          <p class="sub">MP3 / WAV / OGG / FLAC</p>
          <p class="sub" style="margin-top:8px; opacity:0.4;">音乐将自动上传到云端</p>
        </div>
      `;
      return;
    }

    container.innerHTML = State.playlist.map((track, i) => {
      const isActive = i === State.currentIndex;
      const favClass = track.favorite ? 'fav-active' : '';
      const syncStatus = track._uploading ? '同步中' : (track._uploadFailed ? '同步失败' : '');
      const durationText = track.duration ? this.formatTime(track.duration) : '--:--';
      const metaText = syncStatus ? `${durationText} · ${syncStatus}` : durationText;
      return `
        <div class="playlist-item ${isActive ? 'active' : ''}" data-index="${i}">
          <span class="pi-index">${i + 1}</span>
          <div class="pi-info">
            <div class="pi-title">${track.name}</div>
            <div class="pi-duration">${metaText}</div>
          </div>
          <div class="pi-actions">
            <button class="pi-fav ${favClass}" data-fav="${i}" title="${track.favorite ? '取消收藏' : '收藏'}">${track.favorite ? '★' : '☆'}</button>
            <button class="pi-remove" data-remove="${i}" title="删除">✕</button>
          </div>
        </div>
      `;
    }).join('');

    container.onclick = (e) => {
      const favBtn = e.target.closest('[data-fav]');
      if (favBtn) {
        e.stopPropagation();
        Playlist.toggleFavorite(parseInt(favBtn.dataset.fav));
        return;
      }
      const removeBtn = e.target.closest('[data-remove]');
      if (removeBtn) {
        e.stopPropagation();
        const index = parseInt(removeBtn.dataset.remove);
        const track = State.playlist[index];
        if (track && window.confirm(`确定删除「${track.name}」吗？`)) {
          Playlist.removeTrack(index);
        }
        return;
      }
      const item = e.target.closest('[data-index]');
      if (item) {
        Playlist.playTrackAt(parseInt(item.dataset.index));
      }
    };

    const closeMobilePlaylistIfOpen = () => {
      const panelLeft = document.querySelector('.panel-left');
      const mobileBackdrop = document.getElementById('mobilePlaylistBackdrop');
      panelLeft?.classList.remove('mobile-open');
      mobileBackdrop?.classList.remove('show');
    };

    const handlePlaylistSelect = (e) => {
      const now = Date.now();
      if (container._lastSelectAt && now - container._lastSelectAt < 350) return;
      container._lastSelectAt = now;
      if (e.type === 'click' && container._lastTouchSelectAt && now - container._lastTouchSelectAt < 500) return;
      if (e.type !== 'click') container._lastTouchSelectAt = now;
      if (e.type === 'touchend' && container._touchMoved) return;

      const favBtn = e.target.closest('[data-fav]');
      if (favBtn) {
        e.preventDefault();
        e.stopPropagation();
        Playlist.toggleFavorite(parseInt(favBtn.dataset.fav));
        return;
      }

      const removeBtn = e.target.closest('[data-remove]');
      if (removeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(removeBtn.dataset.remove);
        const track = State.playlist[index];
        if (track && window.confirm(`确定删除「${track.name}」吗？`)) {
          Playlist.removeTrack(index);
        }
        return;
      }

      const item = e.target.closest('[data-index]');
      if (item) {
        e.preventDefault();
        e.stopPropagation();
        AudioEngine.resumeContext();
        Playlist.playTrackAt(parseInt(item.dataset.index));
        closeMobilePlaylistIfOpen();
      }
    };

    container.ontouchstart = (e) => {
      const touch = e.changedTouches?.[0];
      container._touchStartX = touch?.clientX ?? 0;
      container._touchStartY = touch?.clientY ?? 0;
      container._touchMoved = false;
    };
    container.ontouchmove = (e) => {
      const touch = e.changedTouches?.[0];
      if (!touch) return;
      const dx = Math.abs((touch.clientX ?? 0) - (container._touchStartX ?? 0));
      const dy = Math.abs((touch.clientY ?? 0) - (container._touchStartY ?? 0));
      if (dx > 10 || dy > 10) container._touchMoved = true;
    };
    container.onclick = handlePlaylistSelect;
    container.onpointerup = handlePlaylistSelect;
    container.ontouchend = handlePlaylistSelect;
  },

  updateVolumeIcon() {
    const high = document.querySelector('.vol-high');
    const mute = document.querySelector('.vol-mute');
    if (State.isMuted || State.volume === 0) {
      high.classList.add('hidden');
      mute.classList.remove('hidden');
    } else {
      high.classList.remove('hidden');
      mute.classList.add('hidden');
    }
  },

  updateTheme() {
    const theme = THEMES[State.themeIndex];
    const root = document.documentElement;
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-secondary', theme.secondary);
    root.style.setProperty('--accent-tertiary', theme.tertiary);
    root.style.setProperty('--accent-glow', theme.accent + '66');
  },

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  formatFileSize(bytes) {
    if (!bytes) return '--';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
};

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', async () => {
  AudioEngine.init();
  Visualizer.init();
  await UI.init();
});
