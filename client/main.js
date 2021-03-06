class ServerTime {
  constructor(intercommunication) {
    this.intercommunication = intercommunication;
    this.detour = undefined; // desvio
    this.maxSampleritems = 20;
    this.minDetour = 20;
    this.minValidSamples = 5;
    this.sampler = [];
    // at first, the server time is equals to local time (with a big detour)
    this.realServerTime = {
      detour: 999999,
      localTime: new Date(),
      time: new Date()
    };
  }
  getSampler() {
    return new Promise((resolve) => {
      const t = new Date();
      this.intercommunication.get('serverTime', ({ data }) => {
        const now = new Date();
        const latency = new Date() - t;

        this.sampler.push({
          serverTime: new Date(new Date(data).getTime() + (latency / 2)),
          localTime: now,
          latency
        });

        if (this.sampler.length > this.maxSampleritems) {
          const latencyArray = this.sampler.map(item => item.latency);
          const maxLatency = Math.max(...latencyArray);
          // remove the one with more latency
          this.sampler.splice(latencyArray.indexOf(maxLatency), 1);
        }
        resolve();
      });
    });
  }
  get() {
    return this.realServerTime.time + (new Date() - this.realServerTime.localTime);
  }
  getDetour() {
    const now = new Date();
    const values = this.sampler.map(
      sample => sample.serverTime.getTime() + (now - sample.localTime)
    );
    let acum = 0;

    for (let i = 0; i < values.length; i += 1) {
      acum += values[i];
    }

    const media = acum / values.length;
    acum = 0;
    for (let i = 0; i < values.length; i+= 1) {
      acum += Math.pow(values[i] - media, 2);
    }

    return Math.sqrt((1 / (values.length - 1)) * acum);
  }
  calculateSeverTime([sample, ...tail], { now = new Date(), samplerCount = 0, samplerAcum = 0 }) {
    if (sample) {
      const count = samplerCount + 1;
      const acum = samplerAcum + sample.serverTime.getTime() + (now - sample.localTime);
      return this.calculateSeverTime(tail, { now, samplerCount: count, samplerAcum: acum });
    }
    return samplerAcum / samplerCount;
  }
  startSynchronization(callback, interval = 1000) {
    setTimeout(() => {
      const detour = this.getDetour();
      // this is the progresive version of the nextInterval
      // let nextInterval = - 20 * detour + 2100;
      // nextInterval = nextInterval > 100 ? nextInterval : 100;
      const nextInterval = 500;
      if (this.getDetour() > this.minDetour || this.sampler.length <= this.minValidSamples) {
        this.getSampler().then(() => {
            this.startSynchronization(callback, nextInterval);
        });
      } else {
        console.log('Synchronization finish');
        if (callback) {
          callback();
        }
      }
      // wait for 5 samples to have a better result
      if (detour < this.realServerTime.detour && this.sampler.length > this.minValidSamples) {
        let time = this.calculateSeverTime(this.sampler, {});
        if (!Number.isNaN(time)) {
          this.realServerTime.detour = detour;
          this.realServerTime.localTime = new Date();
          this.realServerTime.time = this.calculateSeverTime(this.sampler, {});
        }
      }
      window.document.getElementById('detour').innerHTML = Math.round(detour) + ' &#177; ms';
      window.document.getElementById('bestDetour').innerHTML = Math.round(this.realServerTime.detour) + ' &#177; ms';
      if (this.sampler.length < this.minValidSamples) {
        window.document.querySelector('.server-sync-data').innerHTML = 'Recollecting server information...';
      } else {
        if (Math.round(detour) > this.minDetour) {
          window.document.querySelector('.server-sync-data').innerHTML = `Your actual best detur is <b>${Math.round(this.realServerTime.detour)}</b>. You need one smaller than <b>${this.minDetour}</b>`;
        } else {
          window.document.querySelector('.server-sync-data').innerHTML = ':)';
        }
      }
    }, interval);
  }
  startPlayDiffSynchronization() {
    setInterval(() => {
      audioPlayer.getPlayListDiff();
      user.render();
      user.sendStatus();
      displayPlaylistControls();
    }, 5000);
  }
}

//---------------------------------------------------------------------------

class Intercommunication {
  constructor(url) {
    this.initialize(url);
  }
  initialize(url) {
    // if there was a connection before, disconect it.
    if (this.socket) {
      this.socket.disconnect();
    }
    this.socket = io(url, { transports: ['websocket', 'polling', 'flashsocket'] });
    // these events require the petition of the client
    this.eventList = ['serverTime', 'currentTrack', 'timeCurrentTrack', 'addSong', 'removeSong', 'playMusic', 'pauseMusic', 'nextMusic', 'sendMessage', 'sendUserStatus', 'becomeAdmin'];
    // these events are fired by the server
    this.eventSubscribe = ['startPlay', 'stopPlay', 'playlist', 'numberOfConections', 'activityStream'];

    this.pendingMessages = [];
    this.subscribers = [];

    this.processCallbacks = (eventName, data) => {
      this.pendingMessages.forEach((message, index) => {
        if (message.guid === data.guid) {
          if (typeof message.callback === 'function') {
            message.callback(data);
          }
          this.pendingMessages.splice(index, 1);
        }
      });
    };

    this.eventList.forEach((eventName) => {
      this.socket.on(`${eventName}-S`, (data) => {
        this.processCallbacks(eventName, data);
      });
    });

    this.processHandlers = (eventName, data) => {
      this.subscribers.forEach((subscribe) => {
        if (subscribe.eventName === eventName) {
          subscribe.handler(data);
        }
      });
    };
    this.eventSubscribe.forEach((eventName) => {
      this.socket.on(`${eventName}`, (data) => {
        this.processHandlers(eventName, data);
      });
    });
  }
  get(eventName, callback, data) {
    // TODO: Generate GUIDs on the server.
    const guid = Math.floor(Math.random() * 1000000);

    if (~this.eventList.indexOf(eventName)) {
      this.pendingMessages.push({
        guid,
        callback
      });
      this.socket.emit(eventName, {
        guid,
        data
      });
    } else {
      console.warn(`The event '${eventName}' is not defined`);
    }
  }
  subscribe(eventName, handler) {
    const subs = {
      eventName,
      handler
    };

    this.subscribers.push(subs);

    return subs;
  }
  unsubscribe(reference) {
    this.subscribers.splice(this.subscribers.indexOf(reference), 1);
  }
}

// firstPatrol -> omg!
let firstPatrol = true;

//---------------------------------------------------------------------------

class AudioPlayer {
  constructor(intercommunication, serverTime, percentEl) {
    this.intercommunication = intercommunication;
    this.percentEl = percentEl;
    // initialize audio control
    this.audioElement = window.document.createElement('AUDIO');

    this.audioElement.controls = true;

    this.beepSong = './beep.mp3';
    this.src = this.beepSong;
    this.maxDiferenceTolerance = 50;

    this.serverTime = serverTime;
    // these two variables are to set an small offset for mobiles or other devices that have problems with playing music
    this.hardwareDeviceOffset = 0;
    this.hardwareDeviceCuantum = 10;
    this.hardwareDeviceInitialSamples = 4;

    window.document.querySelector('.fake-button').appendChild(this.audioElement);
  }
  loadAudio() {
    return new Promise((resolve) => {
      this.intercommunication.get('currentTrack', ({ data }) => {
        if (data) {
          if (downloader.cachedSongs[data.url] && downloader.cachedSongs[data.url].tmpUrl) {
            if (this.audioElement.src !== downloader.cachedSongs[data.url].tmpUrl) {
              this.setThumbnail();
              this.setSong(downloader.cachedSongs[data.url].tmpUrl);
            }
          } else {
            console.log('The song is not ready');
            this.setSong(undefined);
            downloader.startDownload(data.url, firstPatrol).then(() => {
              console.log('Trying loading again!');
              this.loadAudio();
            });
            firstPatrol = false;
          }
        } else {
          console.error('The play list looks like empty dude :(');
        }
        resolve();
      });
    });
  }
  setSong(songURL = '') {
    this.audioElement.src = songURL;
  }
  seek(time) {
    this.audioElement.currentTime = time / 1000;
  }
  setThumbnail() {
    const src = playlist.currentSong.metadata.thumbnails.medium.url;
    $currentThumbnail
      .src(src)
      .show();

    $background.style('backgroundImage', `url(${src})`);
  }
  play() {
    this.intercommunication.get('timeCurrentTrack', ({ data }) => {
      const { serverTime, trackTime, playing } = data;
      const delay = 2000;
      const timeDifference = Math.round(new Date(serverTime).getTime() + delay) - this.serverTime.get() - this.hardwareDeviceOffset;

      if (timeDifference >= 100 && !Number.isNaN(this.serverTime.getDetour())) {
        setTimeout(() => {
          this.seek(trackTime + delay + ($rangeAdjustment.val() * 1));
          // 100ms looping to have a better performance
          const initialTime = new Date();
          while (new Date() - initialTime < 100) {}
          if (playing) {
            isPlaying = true;
            this.audioElement.play();
          } else {
            isPlaying = false;
            this.audioElement.pause();
          }
          playlist.render();
        }, timeDifference - 100);
      } else {
        console.error('You have too much delay dude :(');
      }
    });
  }
  getPlayListDiff() {
    this.intercommunication.get('timeCurrentTrack', ({ data }) => {
      const { serverTime, trackTime, playing } = data;

      const delay = 2000;
      const timeDifference = Math.round(new Date(serverTime).getTime() + delay) - this.serverTime.get() + ($rangeAdjustment.val() * -1);
      if (timeDifference >= 100) {
        setTimeout(() => {
          // 100ms looping to have a better performance
          const initialTime = new Date();
          while (new Date() - initialTime < 100) {}
          const diff = Math.round((trackTime + delay) - this.audioElement.currentTime * 1000);
          this.diff = diff;
          if (playing) {
            let diffToShow = diff;
            if ($rangeAdjustment.val() !== '0') {
              diffToShow = '(' + diff + ' + ' + ($rangeAdjustment.val() * 1) + ')';
            }
            window.document.getElementById('playDiff').innerHTML = diffToShow + ' ms';
            if (Math.abs(diff) > this.maxDiferenceTolerance) {
              console.log('Re-play');
              if (!audioPlayer.audioElement.paused && audioPlayer.audioElement.readyState) {
                this.hardwareDeviceOffset += this.hardwareDeviceCuantum * Math.sign(diff);
              }

              this.play();
            }

            document.getElementById('hardwareOffset').innerHTML = this.hardwareDeviceOffset + ' ms';
          } else {
            window.document.getElementById('playDiff').innerHTML = '-';
            isPlaying = false;
            this.audioElement.pause();
          }
        }, timeDifference - 100);
      }
    });
  }
  calculateHardwareDeviceOffset(callback, samples = []) {
    console.log('calculateHardwareDeviceOffset -> Prepare');
    audioPlayer.audioElement.currentTime = 0;
    setTimeout(() => {
      console.log('calculateHardwareDeviceOffset -> Starting');
      const initialTime = new Date();
      const onEnded = () => {
        const diff = new Date() - initialTime - (this.audioElement.duration * 1000);
        console.log('calculateHardwareDeviceOffset -> diff', diff);
        clearInterval(backUpTimer);
        audioPlayer.audioElement.removeEventListener('ended', onEnded, false);
        if (samples.length < this.hardwareDeviceInitialSamples) {
          window.document.querySelector('.fake-button').innerHTML = this.hardwareDeviceInitialSamples - samples.length - 1;
          audioPlayer.calculateHardwareDeviceOffset(callback, [...samples, diff]);
        } else {
          if (callback) {
            // normally the first element in 'sample' is not a clear value
            samples.shift();
            const sumOffset = samples.reduce((acum, sample) => acum + sample, 0);
            const avgOffset = sumOffset / samples.length;
            console.log('hardwareDeviceOffset calculation finish');
            callback(Math.round(avgOffset));
          }
        }
      };
      this.audioElement.addEventListener('ended', onEnded, false);
      // sometimes the 'onend' event is not triggered, this is the validation
      const backUpTimer = setTimeout(() => {
        console.log('ended not triggered, re-starting');
        audioPlayer.audioElement.removeEventListener('ended', onEnded, false);
        audioPlayer.calculateHardwareDeviceOffset(callback, samples);
      }, 2000);
      this.audioElement.play();
    }, 1000);
  }
  waitForPlay() {
    this.intercommunication.subscribe('startPlay', () => {
      console.log('PLAY');
      this.play();
    });
    this.intercommunication.subscribe('stopPlay', () => {
      console.log('STOP');
      this.stop();
    });
  }
  stop() {
    isPlaying = false;
    this.audioElement.pause();
    playlist.render();
  }
}

//---------------------------------------------------------------------------

class PlayList {
  constructor(id, intercommunication, audioPlayer) {
    this.intercommunication = intercommunication;
    this.audioPlayer = audioPlayer;
    this.songs = [];
    this.users = [];
    this.currentSong = 0;
    this.id = id;
  }
  get() {

  }
  addSong(url) {
    if (loadingSong) {
      console.log('Wait until current song is loaded.')
      return
    }
    
    console.log('Playlist: Adding song...', url);
    loadingSong = true;
    $loading.show();
    this.intercommunication.get('addSong', (resp) => {
      if (resp.data.error) {
        alert('There was an error when we try to add the song. Try with another one');
      } else {
        console.log('Song added successfully!');
      }

      $loading.hide();
      loadingSong = false;
    }, {
      url
    });
  }

  addSongById(id) {
    this.addSong(`https://www.youtube.com/watch?v=${id}`)
  }

  removeSong(url) {
    $loading.show();
    this.intercommunication.get('removeSong', () => {
      $loading.hide();
    }, {
      url
    });
  }
  waitForPlayList() {
    this.intercommunication.subscribe('playlist', ({ data }) => {
      const { songs, currentSong } = data;
      this.songs = songs;
      // check app.initialSyncFinish to verify the hardware offset properly
      if ((!currentSong || !this.currentSong || this.currentSong.url !== currentSong.url) && app.initialSyncFinish) {
        this.audioPlayer.stop();
        this.audioPlayer.loadAudio().then(() => {
          this.audioPlayer.play();
        });
      }
      this.currentSong = currentSong || {};

      this.render();

      menu.playlistPage.addClass('new-activity');
    });
  }

  waitForNumberOfConections() {
    this.intercommunication.subscribe('numberOfConections', ({ data }) => {
      this.users = data;
      this.checkForAdminPermision();
      window.document.getElementById('userConected').innerHTML = this.users.length;
    });
  }

  isPlayingSong(song) {
    return (isPlaying && this.currentSong.url === song.url);
  }

  getPlayingStatus(song) {
    let playingStatus = '<img class="playing" src="playing.gif" />';
    if (!this.isPlayingSong(song)) playingStatus = '';
    return playingStatus;
  }

  getSongActions(song) {
    let actions = '';

    // Get percentage downloaded.
    let percent = 0;
    if (downloader.cachedSongs[song.url]) {
      percent = downloader.cachedSongs[song.url].percentComplete;
    }

    const deleteAction = `
      <a onclick="removeSongToPlayList('${song.url}')">
        <i class="material-icons">cancel</i>
      </a>
    `;
    // const playingStatus = '<img class="playing" src="playing.gif" />';
    const downloadSong = `
      <a onclick="downloadSong('${song.url}')">
        <i class="material-icons">cloud_download</i>
      </a>
    `;
    const downloadFile = `
      <a onclick="downloadFile('${song.url}')">
        <i class="material-icons">file_download</i>
      </a>
    `;
    const downloadingStatus = `
      <a onclick="cancelDownload('${song.url}')">
        <span class="downloaded">${percent}%</span>
      </a>
    `;

    // Paused, fully downloaded.
    if (percent === 100) actions = downloadFile;

    // Downloading.
    if (percent > 0 && percent < 100) actions = downloadingStatus;

    // Not started.
    if (percent === 0) actions = downloadSong;

    if (adminPermission) {
      // Delete action
      actions += deleteAction;
    }

    // Playing.
    // if (isPlayingCurrentSong && percent === 100) {
    //   actions = downloadFile + playingStatus;
    // }

    return actions;
  }

  getSongId(song) {
    return this.currentSong.metadata.id; // YouTube
  }
  checkForAdminPermision() {
    const myReferenceInUsers = this.users.find(user => (user.id === userId));
    if (myReferenceInUsers) {
      adminPermission = myReferenceInUsers.admin;
    } else {
      console.warn('The current user was not found in the user array');
    }
  }
  render() {
    let el = '';
    let currentSongId = 'No song.';
    const songsLabel = (this.songs.length === 1) ? 'song' : 'songs';

    el = `
    <label>
      ${this.songs.length} ${songsLabel} added
    </label>`;

    if (this.currentSong && this.currentSong.metadata) {
      currentSongId = this.getSongId(this.currentSong);
    }

    for (let i = 0; i < this.songs.length; i += 1) {
      const song = this.songs[i];
      let currentSongClass = this.currentSong.url === song.url ? ' current-song' : '';

      const playingStatus = this.getPlayingStatus(song);
      const playingClass = (isPlaying)? ' is-playing' : '';
      const actions = this.getSongActions(song);
      el += `
      <ul>
        <li class="song-row${currentSongClass}">
          ${playingStatus}
          <span id="song-${currentSongId}" class="song-title${playingClass}" title="${song.metadata.title}">
            ${song.metadata.title}
          </span>
          <span class="song-actions">${actions}</span>
        </li>
      </ul>
      `;
    }

    $playlist.html(el);
    if (menu.active === 'playlistPage') $playlist.show();
  }
}

//---------------------------------------------------------------------------

class User {
  constructor() {
    this.temporalName = ('Guest' + Math.round(Math.random() * 1000 + 1000));
  }
  getName() {
    let username = window.document.getElementById('userName').value;
    if (username === '') {
      username = this.temporalName;
    }
    return username;
  }
  sendStatus() {
    intercommunication.get('sendUserStatus', () => {}, {
      id: userId,
      username: this.getName(),
      detour: serverTime.realServerTime.detour,
      playDiff: audioPlayer.diff,
      playOffset: window.document.getElementById('rangeAdjustment').value,
      hardwareOffset: audioPlayer.hardwareDeviceOffset,
      isPlaying: isPlaying && downloader.cachedSongs[playlist.currentSong.url].percentComplete === 100
    });
  }
  render() {
    let el = `
    <label>
      ${playlist.users.length} users
    </label>
    <ul>
    `;
    for (let i = 0; i < playlist.users.length; i += 1) {
      let diffToShow = Math.round(playlist.users[i].playDiff) + ' ms';
      if (playlist.users[i].playOffset !== '0') {
        diffToShow = '(' + playlist.users[i].playDiff + ' + ' + (playlist.users[i].playOffset * 1) + ') ms';
      }
      let detour = Math.round(playlist.users[i].detour);
      let playing =  '';
      if (playlist.users[i].isPlaying) {
        playing = '<img class="playing" src="playing.gif" />';
      } else {
        diffToShow = '-';
      }
      const isAdmin = playlist.users[i].admin ? 'ADMIN -': '';
      el += `
      <li>
        <span>
          <b>${isAdmin}</b>
        </span>
        <b>
          ${playlist.users[i].username} -
        </b>
        <span>
          <b>Detour:</b> ${detour} &#177; ms /
        </span>
        <span>
          <b>Play diff:</b> ${diffToShow}
        </span>
        <span>
          <b>Hw offset:</b> ${playlist.users[i].hardwareOffset}
        </span>
        <span>
          ${playing}
        </span>
      `;
      if (!isAdmin && adminPermission) {
        const becomeAdminAction = `
          <a onclick="becomeAdmin('${playlist.users[i].id}')">
            <i class="material-icons">accessibility</i>
          </a>
        `;
        el += becomeAdminAction;
      }
      el += '</li>';
    }
    el += '</ul>';

    $users.html(el);
  }
}

//---------------------------------------------------------------------------

class Chat {
  constructor(intercommunication) {
    this.intercommunication = intercommunication;
    this.guid = 'user-' + Math.floor(Math.random() * 1000000); // TODO: set on server!
    this.emoticonsShown = false;

    // Style own messages.
    El.injectStyles(`
      .message.${this.guid} .username {
        background: #9bd979;
      }
    `);
  }

  waitForActivityStream() {
    this.intercommunication.subscribe('activityStream', ({ data }) => {
      menu.chat.addClass('new-activity');
      this.addActivity(data.message);
    });
  }

  setUsername(username) {
    if (!username || !username.trim()) {
      $username.val('');
      return;
    }

    this.username = username;
    $username.hide();
    $message
      .show()
      .focus()
      .html('');
    $emoticonSelector.show();
    setTimeout(() => {
      $message.html('');
    })
  }

  imageTransformation(message) {
    return `<img src="${message}" class="message-image" />`;
  }

  codeTransformation(message) {
    return `
      <span class="code">
        ${
          message
            .replace(/^`/, '')
            .replace(/`$/, '')
            // .replace(/&nbsp; &nbsp;/g, '&nbsp;')
            // .replace(/&nbsp; &nbsp;/g, '&nbsp;')
            // .replace(/\&nbsp;/g, '<br>')
        }
      </span>
    `;
  }

  applyTransformations(message) {
    const transformations = {
      imageTransformation: /^http(s)?:\/\/.*\.(jpg|jpeg|png|gif|webp)$/,
      codeTransformation: /^`.*`$/g
    }

    // Strip HTML to clean up message when not an emoticon.
    if (!message.match(/<img src=".*emoticons.*class="emoticon">/)) {
      message = message.replace(/<(?:.|\n)*?>/gm, '');
    }

    // Apply other transformations.
    Object.keys(transformations)
    .some((transformationName) => {
      if (message.match(transformations[transformationName])) {
        message = this[transformationName](message);
      }
    });

    return message;
  }

  sendMessage(message, event) {
    event.stopPropagation();
    event.preventDefault();

    $message.disable();
    $messageSending.show();
    message = this.applyTransformations(message);
    this.intercommunication.get('sendMessage', ({ data }) => {
      $messageSending.hide();
      $message
        .html('')
        .enable()
        .focus();

      // Ensure emoticons are closed.
      $emoticons.hide();

      setTimeout(() => $activityStream.scrollBottom())
    }, {
      message,
      userName: this.username || 'Anonymous',
      guid: this.guid
    });
  }

  addActivity(message) {
    $activityStream
      .appendHtml(message)
      .scrollBottom();
  }

  toggleEmoticons() {
    $emoticons.toggle()
  }

  addEmoticon(event) {
    const src = event.target.currentSrc;
    $message
      .appendHtml(`<img src="${src}" class="emoticon" />`)
      .caretEnd();
  }
}

//---------------------------------------------------------------------------

class Downloader {
  constructor(playlist) {
    this.playlist = playlist.song;
    this.cachedSongs = {};
  }
  // patrol:bool -> will loop over all songs to check for new downloads
  startDownload(filename, patrol = false) {
    let promise;
    if (!this.cachedSongs[filename]) {
      this.cachedSongs[filename] = {};
      promise = new Promise((resolve) => {
        const xhttp = new XMLHttpRequest();
        xhttp.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            this.cachedSongs[filename].percentComplete = percentComplete;
            console.log(`Downloading: (${filename}) ${percentComplete}%`);
            playlist.render();
          }
        });

        xhttp.addEventListener('load', () => {
          if (xhttp.status == 200) {
            const tmpUrl = window.URL.createObjectURL(xhttp.response);
            this.cachedSongs[filename].tmpUrl = tmpUrl;
            resolve();
          }
        });

        xhttp.open('GET', filename);
        xhttp.responseType = 'blob';
        xhttp.send();
      });
    } else {
      if (this.cachedSongs[filename].tmpUrl) {
        console.log('This song is already downloaded', filename);
      } else {
        console.log('Download is already in progress', filename);
      }
      promise = new Promise((resolve) => {
        // wait for 5 second to check the next song
        setTimeout(resolve, 5000);
      });
    }
    if (patrol) {
      promise.then(() => {
        // Once this finish, start downloading the next song
        let nextSong = playlist.songs[playlist.songs.indexOf(playlist.songs.find((song) => {
          return song.url === filename;
        })) + 1];

        if (!nextSong) {
          nextSong = playlist.songs[0];
        }
        if (!nextSong) {
          // probably the playlist is empty
          nextSong = {};
        }
        this.startDownload(nextSong.url, true);
      });
    }
    return promise;
  }
}

//---------------------------------------------------------------------------

class App {
  constructor(url) {
    const percentEl = window.document.getElementById('percent');

    this.intercommunication = new Intercommunication(url);
    this.serverTime = new ServerTime(this.intercommunication);
    this.downloader = new Downloader(this.intercommunication);
    this.audioPlayer = new AudioPlayer(this.intercommunication, this.serverTime, percentEl);
    this.playlist = new PlayList('playlist', this.intercommunication, this.audioPlayer);
    this.user = new User();
    this.chat = new Chat(this.intercommunication);

    // Syncronization procces

    this.initialSyncFinish = false;

    let serverSyncronization = false;
    let hardwareOffsetSyncronization = false;

    const onDummySongLoaded = () => {
      audioPlayer.audioElement.removeEventListener('loadeddata', onDummySongLoaded, false);
      window.document.querySelector('.fake-button').style.background = 'firebrick';
    };
    const onPlay = () => {
      audioPlayer.audioElement.removeEventListener('play', onPlay, false);
      // hide the player to avoid multiple clicks
      audioPlayer.audioElement.style.visibility = 'hidden';
      audioPlayer.audioElement.volume = 0;
      this.audioPlayer.calculateHardwareDeviceOffset((offsetAvg) => {
        this.audioPlayer.hardwareDeviceOffset = offsetAvg;
        hardwareOffsetSyncronization = true;
        window.document.querySelector('.fake-button').style.background = 'grey';
        audioPlayer.audioElement.volume = 1;
        this.audioPlayer.setSong(undefined);
      });
    };
    // prepare the dummy song
    this.audioPlayer.setSong(this.audioPlayer.beepSong);

    this.audioPlayer.audioElement.addEventListener('loadeddata', onDummySongLoaded, false);
    this.audioPlayer.audioElement.addEventListener('play', onPlay, false);

    this.serverTime.startSynchronization(() => {
      serverSyncronization = true;
    });

    // this is very importart here to read the 'welcome actions' from the server
    this.playlist.waitForPlayList();

    const verificationSyncInterval = setInterval(() => {
      if (serverSyncronization && hardwareOffsetSyncronization) {
        console.log('We are ready to go');
        this.initialSyncFinish = true;
        this.audioPlayer.loadAudio();
        clearInterval(verificationSyncInterval);

        this.serverTime.startPlayDiffSynchronization();
        this.audioPlayer.waitForPlay();
        this.playlist.waitForNumberOfConections();
        this.chat.waitForActivityStream();

        window.document.querySelector('.syncronization-modal').style.display = 'none';
      }
    }, 2000);
  }
  addSongToPlayList(songUrl) {
    this.playlist.addSong(songUrl);
  }
  addSongToPlayListById(id) {
   this.playlist.addSongById(id); 
  }
  removeSongToPlaylist(songUrl) {
    this.playlist.removeSong(songUrl);
  }
  play() {
    this.intercommunication.get('playMusic');
  }
  pause() {
    this.intercommunication.get('pauseMusic');
  }
  next() {
    this.intercommunication.get('nextMusic');
  }
  sendMessage(message, userName) {
    this.chat.sendMessage(message, userName);
  }
  onPaste(event) {
    // Do nothing when pasting text in the chat.
    if (event.target.id === 'messageText') return;

    const clipboard = event.clipboardData || window.clipboardData;
    const pasted = clipboard.getData('Text');
    console.log('PASTED:', pasted);

    app.addSongToPlayList(pasted);
  }
  onDrop(event) {
    event.preventDefault();
    event.stopPropagation();

    const text = event.dataTransfer.getData('text');
    console.log('DROPPED text', text);

    app.addSongToPlayList(text);
  }
  becomeAdmin(id) {
    this.intercommunication.get('becomeAdmin', undefined, {
      id
    });
  }
}

//---------------------------------------------------------------------------

class Sources {
  constructor () {
    this.youtubeReady = false
  }

  search (query) {
    console.log('SEARCH:', query)
    $query.disable()
    $searching.show()
    results.clear()
    gapi.client.youtube.search.list({
      q: query,
      part: 'snippet',
      maxResults: '25',
      order: 'rating',
      topicId: '/m/04rlf', // music
      type: 'video',
      videoDuration: 'medium' // 4 to 20 min
    }).then(
      (data) => {
        console.log('SEARCH RESULTS:', data)
        $searching.hide()
        $query
          .clear()
          .enable()
          .focus()

        results.render(data)
      },
      (err) => {
        $searching.hide()
        $query
          .clear()
          .enable()
          .focus()
        throw err
      }
    )
  }

  add (event) {
    // Keep search results open.
    // Maybe we want to add more videos from shown results.
    event.stopPropagation()

    const id = event.target.dataset.id
    app.addSongToPlayListById(id)
  }

  initYouTube (callback) {
    // Initializes the client with the API key and the Translate API.
    gapi.client.init({
      'apiKey': 'AIzaSyDt2mEYU5lp2l-6oaWXSg1VwMyxWMRghc8',
      'discoveryDocs': ['https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest'],
    }).then(
      () => {
        callback()
      },
      (err) => {
        console.log('ERROR:', err.result.error.message)
        throw err
      }
    )
  }

  onYouTubeReady () {
    console.log('--- YT READY! gapi.client.youtube:', gapi.client.youtube)
    this.youtubeReady = true
  }

  init () {
    // Loads the JavaScript client library and then executes callback.
    gapi.load('client', () => {
      this.initYouTube(() => this.onYouTubeReady())
    });
  }
}

//---------------------------------------------------------------------------

class Results {
  constructor () {
    $body.on('click', (event) => {
      if (event.target.id === 'query') return
      this.hide()
    })
  }

  hide () {
    $results.hide()
  }

  show () {
    $results.show()
  }

  clear () {
    $results.html('')
  }

  render (data) {
    let html = ''
    data.result.items.map((item) => {
      const id = item.id.videoId
      const thumb = item.snippet.thumbnails.default // [high | medium]
      const title = item.snippet.title

      html += `
        <div class="result-item">
          <div class="result-title ellipsis" data-id="${id}">${title}</div>
        </div>
      `
    })

    $results.appendHtml(html)
    $results.show()
  }
}

//---------------------------------------------------------------------------

class Connection {
  constructor() {
    this.url = `http://${configuration.spinner}`;
    this.onRoomCallback;
  }

  start(callback) {
    console.log('Start websocket');
    this.onRoomCallback = callback;
    this.socket = io(this.url, { transports: ['websocket', 'polling', 'flashsocket'] });
    this.socket.on('connect', () => {
      this.events();
      this.connectRoom();
    });
  }

  events() {
    this.socket.on('room', (data) => {
      console.log('GOT ROOM:', data);
      this.onRoomCallback(data);
    });
  }

  connectRoom() {
    this.roomId = this.getRoomId();
    this.socket.emit('room', { id: this.roomId });
  }

  getRoomId() {
    function getParameterByName(name, url) {
      if (!url) url = window.location.href;
      name = name.replace(/[\[\]]/g, "\\$&");
      var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
          results = regex.exec(url);
      if (!results) return null;
      if (!results[2]) return '';
      return decodeURIComponent(results[2].replace(/\+/g, " "));
    }
    return getParameterByName('id');
  }
}

//---------------------------------------------------------------------------

class Menu {
  constructor() {
    this.playlistPage = new El('#menu-playlist');
    this.chat = new El('#menu-chat');
    this.rooms = new El('#menu-rooms');
    this.users = new El('#menu-users');
    this.active = 'playlistPage';

    this.content = {
      playlistPage: new El('#playlistPage'),
      chat: new El('#chat'),
      users: new El('#users'),
      rooms: new El('#rooms')
    };
  }

  show(name) {
    // Hide previously active.
    this.content[this.active].hide();
    this[this.active].removeClass('active');

    // Show current.
    // TODO: Do something more elegant!
    if (name === 'chat') {
      menu.chat.removeClass('new-activity');
      if ($username.isVisible()) {
        setTimeout(() => $username.focus());
      } else {
        $message.focus();
      }

      setTimeout(() => $activityStream.scrollBottom());
    } else if (name === 'playlistPage') {
      menu.playlistPage.removeClass('new-activity');
      $query.focus();
    }

    this.active = name;
    this[name].addClass('active');
    this.content[name].show();
  }
}

//---------------------------------------------------------------------------

// //////////////////////////////////////////////
// //////////////////////////////////////////////
// application starts

// Set elements.
const $body = new El('body');
const $loading = new El('#loading');
const $searching = new El('#searching');
const $playlist = new El('#playlist');
const $results = new El('#results');
const $users = new El('#users');
const $background = new El('#background');
const $username = new El('#userName');
const $message = new El('#messageText');
const $messageSending = new El('#message-sending');
const $rangeAdjustment = new El('#rangeAdjustment');
const $emoticonSelector = new El('.emoticon-selector');
const $emoticons = new El('#emoticons');
const $currentThumbnail = new El('#currentThumbnail');
const $query = new El('#query');
const $activityStream = new El('#activityStream')

// expose the object to the entry world

let app;
let intercommunication;
let serverTime;
let downloader;
let audioPlayer;
// the 'var' is needed for safari compatibility, otherwise, a global variable definition conflict error will be triggered
var playlist;
let user;
let menu;
let userId = getCookie('user');
let adminPermission = false;
let isPlaying = false;
let loadingSong = false;

const results = new Results()
const sources = new Sources()
sources.init()

const connection = new Connection();

connection.start(({ url }) => {
  console.log('CONNECTED to SPINNER!');
  if (!app) {
    app = new App(url);
    intercommunication = app.intercommunication;
    serverTime = app.serverTime;
    downloader = app.downloader;
    audioPlayer = app.audioPlayer;
    playlist = app.playlist;
    user = app.user;
    menu = new Menu();
  } else {
    // here, the spinner has restarted

    // update the room url
    intercommunication.initialize(url);
  }
});

// Randomize background.
$background.setRandomBackground({
  path: 'backgrounds',
  range: [1, 18]
});

function removeSongToPlayList(songUrl) {
  app.removeSongToPlaylist(songUrl);
}
function playMusic() {
  app.play();
}
function pauseMusic() {
  app.pause();
}
function nextMusic() {
  app.next();
}
function sendMessage() {
  const message = $message.val();
  const userName = $username.val();
  if (userName.length) {
    app.sendMessage(message, userName);
    window.document.getElementById('messageText').value = '';
    window.document.getElementById('userName').disabled = true;
  } else {
    window.alert('Hey dude!, don\'t forget your name');
  }
}

function downloadSong(songUrl) {
  console.log('DOWNLOAD:', songUrl);
  downloader.startDownload(songUrl);
}

function downloadFile(songUrl) {
  // TODO: write filename using song title.
  const filename = 'listensync-download.mp3';
  const data = downloader.cachedSongs[songUrl].tmpUrl;
  const element = document.createElement('a');
  element.setAttribute('href', data);
  element.setAttribute('download', filename);

  element.style.display = 'none';
  document.body.appendChild(element);

  element.click();
  document.body.removeChild(element);
}

function cancelDownload(songUrl) {
  alert('Comming soon!');
}

function manualAdjustment(val) {
  window.document.getElementById('rangeAdjustmentValue').innerHTML = val + ' ms';
}

function showRange(value) {
  document.getElementById('offsetContainer').style.display = value ? 'block' : 'none';
  if (!value) {
    document.getElementById('rangeAdjustment').value = 0;
    manualAdjustment(0);
  }
}

function displayPlaylistControls() {
  const state = adminPermission ? 'inline-block' : 'none';
  document.getElementById('stopMusicButton').style.display = state;
  document.getElementById('nextMusicButton').style.display = state;
}

function becomeAdmin(id) {
  app.becomeAdmin(id);
}

function toArray (list) {
  return Array.prototype.slice.call(list || [], 0);
}

function getCookie(cname) {
  var name = cname + "=";
  var decodedCookie = decodeURIComponent(document.cookie);
  var ca = decodedCookie.split(';');
  for(var i = 0; i <ca.length; i++) {
    var c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  // redirect to home page to make the authentication
  window.location = '/';
  return '';
}

function stripHtml (html) {
  var tmp = document.createElement('DIV');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

mdc.autoInit();
