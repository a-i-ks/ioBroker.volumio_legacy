/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

const Promise = require('promise');
const request = Promise.denodeify(require('request'));

// you have to require the utils module and call adapter function
const utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.volumio.0
const adapter = new utils.Adapter('volumio');

/*Variable declaration, since ES6 there are let to declare variables. Let has a more clearer definition where 
it is available then var.The variable is available inside a block and it's childs, but not outside. 
You can define the same variable name inside a child without produce a conflict with the variable of the parent block.*/
// let variable = 1234;

let application = {
    protocol: 'http://',
};

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));

});

// is called if a subscribed state changes
// id => volumio.0.player.pause
// obj => {"val":true,"ack":false,"ts":1545603169862,"q":0,"from":"system.adapter.admin.0","lc":1545603169862}
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));
    if (!id) return;
    // if (!state || state.ack) return; //TODO Check this
    // TODO check this
    // you can use the ack flag to detect if it is status (true) or command (false)
    //if (state && !state.ack) {
    //    adapter.log.info('ack is not set!');
    //} 
    
    switch (id) {
        case "volumio.0.getPlaybackInfo":
            refreshPlaybackInfo();
            break;
        case "volumio.0.player":
        case "volumio.0.player.pause":
        // Todo if played on spotify connect send a message via spotify
        // on/off in einstellungen + select spotify device  
            sendCmdPause();
            break;
        case "volumio.0.player.toggle":
            sendCmdToggle();
            break;
        case "volumio.0.player.play": 
            sendCmdPlay();
            break;
        case "volumio.0.player.playN":
            if (state && state.val) {
                sendCmdPlay(state.val)
            }
            break; 
        case "volumio.0.player.stop":
            sendCmdStop();
            break;
        case "volumio.0.player.next":
            sendCmdNext();
            break;
        case "volumio.0.player.prev":
            sendCmdPrev();
            break;
        case "volumio.0.player.mute":
            sendCmdMute();
            break;
        case "volumio.0.player.unmute":
            sendCmdUnmute();
            break;
        case "volumio.0.player.volumeUp":
            sendCmdVolumeUp();
            break;
        case "volumio.0.player.volumeDown":
            sendCmdVolumeDown();
            break;
        case "volumio.0.player.volume":
            if (state && state.val) {
                sendCmdVolume(state.val)
            }
            break;
    }

});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj === 'object' && obj.message) {
        if (obj.command === 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function sendRequest(endpoint, method, sendBody) {
	let options = {
        url: application.protocol + adapter.config.host + endpoint,
        method: method,
        form: sendBody
    };
    adapter.log.debug('volumio api call...' + endpoint + '; ' + options.form);
    let callStack = new Error().stack;
    return request(options)
        .then(function(response) {
        	let body = response.body;
        	let ret;
        	let parsedBody;
            try {
                parsedBody = JSON.parse(body);
            } catch (e) {
                parsedBody = {
                    error: {
                        message: "unable to parse response"
                    }
                };
            }
            switch (response.statusCode) {
                case 200:
                    // OK
                    adapter.log.debug('200 OK');
                    adapter.log.debug('http response: ' + JSON.stringify(response));
                    ret = parsedBody;
                    break;
                case 202:
                    // Accepted, processing has not been completed.
                    adapter.log.debug('http response: ' + JSON.stringify(response));
                    ret = Promise.reject(response.statusCode);
                    break;
                case 204:
                    // OK, No Content
                    ret = null;
                    break;
                case 400:
                    // Bad Request, message body will contain more
                    // information
                case 500:
                    // Server Error
                case 503:
                    // Service Unavailable
                case 404:
                    // Not Found
                case 502:
                    // Bad Gateway
                    ret = Promise.reject(response.statusCode);
                    break;
                case 401:
                    // Unauthorized
                    ret = Promise.all([
                        cache.set('authorization.authorized', false),
                        cache.set('info.connection', false)
                    ]).then(function() {
                            adapter.log.error(parsedBody.error.message);
                            return Promise.reject(response.statusCode);
                        });
                    break;
                case 429:
                    // Too Many Requests
                	let wait = 1;
                    if (response.headers.hasOwnProperty('retry-after') && response.headers['retry-after'] >
                        0) {
                        wait = response.headers['retry-after'];
                        adapter.log.warn('too many requests, wait ' + wait + 's');
                    }
                    ret = new Promise(function(resolve) {
                        setTimeout(resolve, wait * 1000);
                    }).then(function() {
                        return sendRequest(endpoint, method, sendBody);
                    });
                    break;
                default:
                    adapter.log.warn('http request error not handled, please debug');
                    adapter.log.warn(callStack);
                    adapter.log.warn(new Error().stack);
                    adapter.log.debug('status code: ' + response.statusCode);
                    adapter.log.debug('body: ' + body);
                    ret = Promise.reject(response.statusCode);
            }
            return ret;
        }).catch(function(err) {
            adapter.log.error('erron in request: ' + err);
            return 0;
        });
}

function main() {
    setup();
}

function setup() {
    adapter.subscribeStates('*');
}


function sendCmdPause() {
    sendRequest('/api/v1/commands/?cmd=pause', 'GET', '');
}

function sendCmdToggle() {
    sendRequest('/api/v1/commands/?cmd=pause', 'GET', '');
}

function sendCmdPlay(n) {
    if(n && Number.isInteger(n) ) {
        sendRequest('/api/v1/commands/?cmd=play&N='+n, 'GET', '');
    } else {
        sendRequest('/api/v1/commands/?cmd=play', 'GET', '');
    }
}

function sendCmdStop() {
    sendRequest('/api/v1/commands/?cmd=stop', 'GET', '');
}

function sendCmdPrev() {
    sendRequest('/api/v1/commands/?cmd=prev', 'GET', '');
}

function sendCmdNext() {
    sendRequest('/api/v1/commands/?cmd=next', 'GET', '');
}

function sendCmdMute() {
    sendRequest('/api/v1/commands/?cmd=volume&volume=mute', 'GET', '');
}

function sendCmdUnmute() {
    sendRequest('/api/v1/commands/?cmd=volume&volume=unmute', 'GET', '');
}

function sendCmdVolumeUp() {
    sendRequest('/api/v1/commands/?cmd=volume&volume=plus', 'GET', '');
}

function sendCmdVolumeDown() {
    sendRequest('/api/v1/commands/?cmd=volume&volume=minus', 'GET', '');
}

function sendCmdVolume(value) {
    if(value && Number.isInteger(value) ) {
        sendRequest('/api/v1/commands/?cmd=volume&volume='+value, 'GET', '');
    }
}

function createPlaybackInfo(data) {
    if (isEmpty(data)) {
        adapter.log.debug('no playback content');
        return Promise.reject('no playback content');
    }
    let playStatus = loadOrDefault(data, 'device.id', '');
}

/**
 * If obj.name is available return this,
 * else return defaultVal
 */
function loadOrDefault(obj, name, defaultVal) {
	let t = undefined;
    try {
        eval('t = obj.' + name + ';');
    } catch (e) {}
    if (t === undefined) {
        t = defaultVal;
    }
    return t;
}

function refreshPlaybackInfo() {
   let playbackInfo;
   playbackInfo = sendRequest('/api/v1/getstate', 'GET', '');
   adapter.log.info("playback refeshed")
}