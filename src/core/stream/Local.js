import * as StreamTypes from '../../definitions/StreamTypes';
import * as Log from '../util/Log';
import cache from '../util/cache';
import * as DataSync from '../util/DataSync';
import Media from '../util/Media';
import {
  CLOSED,
  CLOSING,
  CONNECTED,
  NONE
} from '../util/constants';
import * as Events from '../../definitions/Events';

const _facingModes = [Media.facingMode.USER, Media.facingMode.ENVIRONMENT];

const _getConstraintValue = (constraints, prop) => (
  constraints[prop].exact || constraints[prop].ideal || constraints[prop]
);

/* eslint-disable no-param-reassign */
const _setConstrainValue = (constraints, prop, other, value) => {
  constraints[prop] = { exact: value };
  delete constraints[other];
};
/* eslint-enable no-param-reassign */

/**
 * The local stream
 */
export default class Local {
  /**
   * @access protected
   * @param {object} values
   */
  constructor(values) {
    /**
     * The uid of the room the stream is published in
     * @type {string}
     */
    this.roomId = values.roomId;
    /**
     * The uid of this stream
     * @type {string}
     */
    this.uid = values.uid;
    /**
     * The type of the stream
     * @type {string}
     */
    this.type = values.type;
    /**
     * Indicates if a track is muted
     * @type {{audio: boolean, video: boolean}}
     */
    this.muted = Object.assign({ audio: false, video: false }, values.muted);
    /**
     * The local DOM container element where the {@link Local~media} is displayed
     * @type {Element}
     */
    this.container = values.container || cache.config.localStreamContainer;
    /**
     * The local DOM media element where the {@link Local~media} is displayed
     * @type {Element}
     */
    this.node = null;
    /**
     * List of the PeerConnections associated to this local stream
     * @type {PeerConnection[]}
     */
    this.peerConnections = [];
    /**
     * Local stream status
     * @type {string}
     */
    this.status = NONE;
    /**
     * is the video is loaded int the local DOM media element
     * @type {boolean}
     */
    this.isVideoLoaded = false;
    /**
     * @access private
     * @type {{audio: string, video: string}}
     */
    this._inputs = {};

    // Set constraints
    this.constraints = values.constraints;

    /**
     * List of callbacks for Local
     * @type object
     * @private
     */
    this._callbacks = {};
  }


  /**
   * Register a callback for a specific event
   * @param {string} event The event name ({@link Events/Stream})
   * @param {function} callback The callback for the event
   */
  on(event, callback) {
    if (Events.local.supports(event)) {
      if (!this._callbacks[event]) {
        this._callbacks[event] = [];
      }
      this._callbacks[event].push(callback);
    }
  }

  /**
   * Register a callback for a specific event
   * @param {string} [event] The event name ({@link Events/Stream})
   * @param {function} [callback] The callback for the event
   */
  off(event, callback) {
    if (!event) {
      this._callbacks = {};
    } else if (Events.local.supports(event)) {
      if (!callback) {
        this._callbacks[event] = [];
      } else {
        this._callbacks[event] = this._callbacks[event].filter(cb => cb !== callback);
      }
    }
  }

  /**
   * The Media Constraints. (defaults to global config)
   * @param {MediaConstraints} constraints
   */
  set constraints(constraints) {
    const
      values = constraints || cache.config.constraints;


    const defaultConstraints = Media.constraints();
    ['audio', 'video'].forEach((type) => {
      if (!~this.type.indexOf(type)) { // eslint-disable-line no-bitwise
        values[type] = false;
      } else if (!values[type]) {
        values[type] = defaultConstraints[type];
      }
      if (values[type].deviceId || values[type].facingMode) {
        this._inputs[type] = _getConstraintValue(
          values[type],
          values[type].facingMode ? 'facingMode' : 'deviceId'
        );
      }
    });
    Log.d('Local~set#contraints', values);
    /**
     * @ignore
     */
    this._constraints = values;
  }

  /**
   * The Media Constraints. (defaults to global config)
   * @type {MediaConstraints}
   */
  get constraints() {
    return this._constraints;
  }

  /**
   * Updates the stream constraints and retrieve the new MediaStream
   * @param constraints
   * @returns {*|Promise.<TResult>}
   */
  updateConstraints(constraints) {
    Log.d('Local~updateConstraints', constraints);
    this.constraints = constraints;
    return navigator.mediaDevices.getUserMedia(this.constraints)
      .catch((e) => {
        (this._callbacks[Events.local.WEBRTC_ERROR] || [])
          .forEach(cb => cb(e));
        return e;
      })
      .then((media) => {
        ['audio', 'video'].forEach((kind) => {
          const constraintsValue = this.constraints[kind];
          if (constraintsValue) {
            if (constraintsValue.deviceId || constraintsValue.facingMode) {
              this._inputs[kind] = _getConstraintValue(
                constraintsValue,
                constraintsValue.facingMode ? 'facingMode' : 'deviceId'
              );
            }
          }
        });
        this.media = media;
      });
  }

  /**
   * The associated MediaStream
   * @type {MediaStream}
   */
  set media(mediaStream) {
    if (mediaStream) {
      if (!(mediaStream instanceof MediaStream)) {
        throw new Error('The media MUST be a MediaStream');
      }

      const checkDevices = {};
      mediaStream.getTracks().forEach((track) => {
        // Reset mute
        track.enabled = !this.muted[track.kind]; // eslint-disable-line no-param-reassign
        // Get device label
        if (!this._inputs[track.kind]) {
          checkDevices[track.kind] = track.label;
        }
      });
      // Try to get deviceId from label
      if (Object.keys(checkDevices).length) {
        Media.devices().then((devices) => {
          Object.keys(checkDevices).forEach((kind) => {
            if (devices[`${kind}input`]) {
              const deviceIds = devices[`${kind}input`]
                .filter(device => device.label.length && device.label === checkDevices[kind]);
              if (deviceIds.length === 1 && !this._inputs[kind]) {
                this._inputs[kind] = deviceIds[0].deviceId;
              }
              if (deviceIds.length === 0
                && devices[`${kind}input`][0].label === ''
                && !this._inputs[kind]) {
                // from a webview, the label is not delivered
                this._inputs[kind] = devices[`${kind}input`][0].deviceId;
              }
            }
          });
        });
      }
      // Display
      this.node = Media.attachStream(mediaStream, this.container, this.node, 0);
      this.node.onloadeddata = () => {
        this.isVideoLoaded = true;
      };
      this.status = CONNECTED;
      Log.d('Local~set media', { mediaStream }, this.node);
      // Renegotiate
      this.peerConnections.forEach(peerConnection => peerConnection.renegotiate(this._media,
        mediaStream));
    } else if (this.media && !mediaStream) {
      // Remove node
      this.node.srcObject = null;
      this.container.removeChild(this.node);
      this.node = null;
      // Stop stream
      this.media.getTracks().forEach(track => track.stop());
      // Close PeerConnections
      this.peerConnections.forEach(peerConnection => peerConnection.close());
    }
    // Save
    /**
     * @ignore
     */
    this._media = mediaStream;
  }

  /**
   * The associated MediaStream
   * @type {MediaStream}
   */
  get media() {
    return this._media;
  }

  /**
   * Mute a track of a Stream
   * @param {string} [track=AUDIO] The track to mute. (AUDIO, VIDEO, AUDIO_VIDEO)
   * @param {boolean} [state=true] true for mute & false for un-mute
   * @example <caption>mute video</caption>
   * stream.mute(Reach.t.VIDEO)
   * @example <caption>mute audio</caption>
   * stream.mute(Reach.t.AUDIO)
   * // or
   * stream.mute()
   */
  mute(track = StreamTypes.AUDIO, state = true) {
    Log.d('mute', track, state);
    let { audio, video } = this.muted;
    let
      tracks;
    switch (track) {
      case StreamTypes.AUDIO:
        audio = state;
        tracks = this.media.getAudioTracks();
        break;
      case StreamTypes.VIDEO:
      case StreamTypes.SCREEN_SHARING:
        video = state;
        tracks = this.media.getVideoTracks();
        break;
      case StreamTypes.AUDIO_VIDEO:
        audio = state;
        video = state;
        tracks = this.media.getTracks();
        break;
      default:
        break;
    }
    // Mute media tracks
    tracks.forEach((track) => { // eslint-disable-line no-shadow
      track.enabled = !state; // eslint-disable-line no-param-reassign
    });
    // Signal subscribers
    this.muted = { audio, video };
    DataSync.set(`_/rooms/${this.roomId}/streams/${this.uid}/muted`, this.muted);
  }

  /**
   * Un-mute a track of a Stream
   * @param {string} [track=AUDIO] The track to mute. (AUDIO, VIDEO, AUDIO_VIDEO)
   * @example <caption>Un-mute video</caption>
   * stream.unMute(Reach.t.VIDEO)
   * @example <caption>Un-mute audio</caption>
   * stream.unMute(Reach.t.AUDIO)
   * // or
   * stream.unMute()
   */
  unMute(track) {
    this.mute(track, false);
  }

  /**
   * Removes stream for published list, closes associated
   * PeerConnections and stops current MediaStream
   * @returns {Promise}
   */
  close() {
    if (!~[CLOSED, CLOSING].indexOf(this.status)) { // eslint-disable-line no-bitwise
      this.status = CLOSING;
      // Stop listening to Subscribers
      const path = `_/rooms/${this.roomId}/subscribers/${this.uid}`;
      DataSync.off(path, 'child_added');
      DataSync.off(path, 'child_removed');
      // Cancel onDisconnects
      DataSync.onDisconnect(`_/rooms/${this.roomId}/streams/${this.uid}`).cancel();
      DataSync.onDisconnect(`_/rooms/${this.roomId}/subscribers/${this.uid}`).cancel();
      // Remove subscribers
      DataSync.remove(path);
      // Remove stream
      DataSync.remove(`_/rooms/${this.roomId}/streams/${this.uid}`);
      this.media = null;
      // Close
      this.status = CLOSED;
    }
    return Promise.resolve(this.status);
  }

  /**
   * Switch video input device
   * @param {string} [deviceId] A video input device Id or the `facingMode` value
   * @returns {Promise<Local, Error>}
   */
  switchCamera(deviceId) {
    return this._switchDevice(StreamTypes.VIDEO, deviceId);
  }

  /**
   * Switch audio input device
   * @param {string} [deviceId] A audio input device Id
   * @returns {Promise<Local, Error>}
   */
  switchMicrophone(deviceId) {
    return this._switchDevice(StreamTypes.AUDIO, deviceId);
  }

  /**
   * Switch input device
   * @access private
   * @param {string} kind The kind of device to switch
   * @param {string} [deviceId] An input device id
   * @returns {Promise<Local, Error>}
   */
  _switchDevice(kind, deviceId) {
    Log.d('Local~_switchDevice', kind, deviceId);
    if (this.media.getTracks().some(track => track.kind === kind)) {
      let next = Promise.resolve(deviceId);
      const currentModeIdx = _facingModes.indexOf(this._inputs[kind]);
      if (!deviceId && !!~currentModeIdx) { // eslint-disable-line no-bitwise
        // Loop facingModes
        next = Promise.resolve(_facingModes[(currentModeIdx + 1) % _facingModes.length]);
      } else if (!~_facingModes.indexOf(deviceId)) { // eslint-disable-line no-bitwise
        // Loop deviceIds
        next = Media.devices()
          .then((d) => {
            // devices IDs
            const devices = d[`${kind}input`].map(mediaDevice => mediaDevice.deviceId);
            // Sort to ensure same order
            devices.sort();
            // New device
            let nextDevice = deviceId;
            if (deviceId && !devices.some(device => device === deviceId)) {
              return Promise.reject(new Error(`Unknown ${kind} device`));
            }
            if (!deviceId && devices.length > 1) {
              let idx = this._inputs[kind]
                ? devices.findIndex(v => v === this._inputs[kind], this)
                : 0;
              nextDevice = devices[++idx % devices.length]; // eslint-disable-line no-plusplus
            }
            return nextDevice;
          });
      } else {
        next = Promise.resolve(deviceId);
      }

      return next
        .then((device) => { // eslint-disable-line consistent-return
          if (this._inputs[kind] !== device) {
            // Update video streams
            this._inputs[kind] = device;
            // Stop tracks
            this.media.getTracks().forEach(track => track.stop());
            // Update constraints
            const constraints = Object.assign({}, this.constraints);
            let props = ['facingMode', 'deviceId'];
            if (!~_facingModes.indexOf(device)) { // eslint-disable-line no-bitwise
              props = props.reverse();
            }
            _setConstrainValue(constraints[kind], props[0], props[1], device);
            Log.d('Local~_switchDevice', kind, constraints);
            return this.updateConstraints(constraints);
          }
        })
        .then(() => this);
    }
    return Promise.reject(new Error(`Current stream does not contain a ${kind} track`));
  }

  /**
   * Publish a local stream
   * @access protected
   * @param {string} roomId The room Id
   * @param {string} type The stream type, see {@link StreamTypes} for possible values
   * @param {?Element} container The element the stream is attached to.
   * @param {?MediaStreamConstraints} [constraints] The stream constraints.
   * If not defined the constraints defined in ReachConfig will be used.
   * @returns {Promise<Local, Error>}
   */
  /* static share(roomId, type, container, constraints) {
    if (!cache.user) {
      return Promise.reject(new Error('Only an authenticated user can share a stream.'));
    }
    const streamMetaData = {
      from: cache.user.uid,
      device: cache.device,
      type
    };


    const sharedStream = new Local(Object.assign({ roomId, constraints, container },
      streamMetaData));
    Log.d('Local~share', { sharedStream });
    return navigator.mediaDevices.getUserMedia(sharedStream.constraints)
      .then((media) => {
        sharedStream.media = media;
      })
      // Got MediaStream, publish it
      .then(() => DataSync.push(`_/rooms/${roomId}/streams`, streamMetaData))
      .then((streamRef) => {
        sharedStream.uid = streamRef.name();
        if (/video/i.test(sharedStream.type)) {
          if (sharedStream.isVideoLoaded) {
            const streamSize = {
              height: sharedStream.node.videoHeight,
              width: sharedStream.node.videoWidth,
            };
            streamRef.update(streamSize);
          } else {
            sharedStream.node.onloadeddata = function () { // eslint-disable-line func-names
              const streamSize = {
                height: sharedStream.node.videoHeight,
                width: sharedStream.node.videoWidth,
              };
              streamRef.update(streamSize);
            };
          }
        }
        if (/video/i.test(sharedStream.type)) {
          window.addEventListener('resize', (() => {
            if (sharedStream.node != null) {
              const streamSize = {
                height: sharedStream.node.videoHeight,
                width: sharedStream.node.videoWidth,
              };
              streamRef.update(streamSize);
            }
          }));
        }
        // Save sharedStream
        cache.streams.shared[sharedStream.uid] = sharedStream;
        // Remove shared stream on Disconnect
        DataSync.onDisconnect(`_/rooms/${roomId}/streams/${sharedStream.uid}`).remove();
        // Remove shared stream on Disconnect
        DataSync.onDisconnect(`_/rooms/${roomId}/subscribers/${sharedStream.uid}`).remove();
        // Start listening to subscribers
        const
          path = `_/rooms/${sharedStream.roomId}/subscribers/${sharedStream.uid}`;


        const value = snapData => Object.assign({ device: snapData.name() }, snapData.val() || {});
        DataSync.on(path, 'child_added',
          (snapData) => {
            const subscriber = value(snapData);
            Log.d('Local~subscribed', subscriber);
            cache.peerConnections.offer(sharedStream, subscriber)
              .then((pc) => {
                (this._callbacks[Events.local.SUBSCRIBED] || [])
                  .forEach(cb => cb(sharedStream, subscriber));
                return sharedStream.peerConnections.push(pc);
              });
          },
          Log.e.bind(Log));
        DataSync.on(path, 'child_removed',
          (snapData) => {
            const subscriber = value(snapData);
            Log.d('Local~un-subscribed', subscriber);
            const closedPC = cache.peerConnections.close(sharedStream.uid, subscriber.device);
            sharedStream.peerConnections = sharedStream.peerConnections
              .filter(pc => pc !== closedPC);
          },
          Log.e.bind(Log));
        Log.d('Local~shared', { sharedStream });
        return sharedStream;
      });
  } */

  /**
   * Get a local stream
   * @access protected
   * @param {string} roomId The room Id
   * @param {string} type The stream type, see {@link StreamTypes} for possible values
   * @param {?Element} container The element the stream is attached to.
   * @param {?MediaStreamConstraints} [constraints] The stream constraints.
   * If not defined the constraints defined in ReachConfig will be used.
   * @returns {Promise<Local, Error>}
   */
  static getLocalVideo(roomId, type, container, constraints) {
    if (!cache.user) {
      return Promise.reject(new Error('Only an authenticated user can share a stream.'));
    }
    const streamMetaData = {
      from: cache.user.uid,
      device: cache.device,
      userAgent: cache.userAgent,
      type
    };


    const sharedStream = new Local(Object.assign({ roomId, constraints, container },
      streamMetaData));
    sharedStream.streamMetaData = streamMetaData;
    Log.d('Local~getLocalVideo', { sharedStream });
    return navigator.mediaDevices.getUserMedia(sharedStream.constraints)
      .then((media) => {
        sharedStream.media = media;
        return sharedStream;
      });
  }

  /**
   * Publish a local stream
   * @access protected
   * @returns {Local}
   */
  publish(sharedStream) {
    Log.d('Local~publish');
    const { roomId } = sharedStream;
    return DataSync.push(`_/rooms/${roomId}/streams`, sharedStream.streamMetaData)
      .then((streamRef) => {
        sharedStream.uid = streamRef.name(); // eslint-disable-line no-param-reassign
        if (sharedStream.isVideoLoaded) {
          const streamSize = {
            height: sharedStream.node.videoHeight,
            width: sharedStream.node.videoWidth,
          };
          streamRef.update(streamSize);
        } else {
          sharedStream.node.onloadeddata = function () { // eslint-disable-line
            const streamSize = {
              height: sharedStream.node.videoHeight,
              width: sharedStream.node.videoWidth,
            };
            streamRef.update(streamSize);
          };
        }
        window.addEventListener('resize', (() => {
          if (sharedStream.node != null) {
            const streamSize = {
              height: sharedStream.node.videoHeight,
              width: sharedStream.node.videoWidth,
            };
            streamRef.update(streamSize);
          }
        }));
        // Save sharedStream
        cache.streams.shared[sharedStream.uid] = sharedStream;
        // Remove shared stream on Disconnect
        DataSync.onDisconnect(`_/rooms/${roomId}/streams/${sharedStream.uid}`).remove();
        // Remove shared stream on Disconnect
        DataSync.onDisconnect(`_/rooms/${roomId}/subscribers/${sharedStream.uid}`).remove();
        // Start listening to subscribers
        const path = `_/rooms/${sharedStream.roomId}/subscribers/${sharedStream.uid}`;
        const value = snapData => Object.assign({ device: snapData.name() }, snapData.val() || {});

        DataSync.on(path, 'child_added',
          (snapData) => {
            const subscriber = value(snapData);
            Log.d('Local~subscribed', subscriber);
            cache.peerConnections
              .offer(sharedStream, subscriber, this._callbacks[Events.local.WEBRTC_ERROR])
              .then((pc) => {
                (this._callbacks[Events.local.SUBSCRIBED] || [])
                  .forEach(cb => cb(sharedStream, subscriber));
                return sharedStream.peerConnections.push(pc);
              });
          },
          Log.e.bind(Log), this);
        DataSync.on(path, 'child_removed',
          (snapData) => {
            const subscriber = value(snapData);
            Log.d('Local~un-subscribed', subscriber);
            const closedPC = cache.peerConnections.close(sharedStream.uid, subscriber.device);
            /* eslint-disable no-param-reassign */
            sharedStream.peerConnections = sharedStream.peerConnections
              .filter(pc => pc !== closedPC);
            /* eslint-enable no-param-reassign */
          },
          Log.e.bind(Log));
        Log.d('Local~shared', { sharedStream });
        return sharedStream;
      });
  }
}
