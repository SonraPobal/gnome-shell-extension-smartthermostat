const ECOBEE_API_KEY = 'ErnooepXQI4or2Bj3Z3M6nu93tmotUFy';
const ECOBEE_API_URL = 'https://api.ecobee.com';

const Lang = imports.lang;
const GObject = imports.gi.GObject;
const Soup = imports.gi.Soup;
const Mainloop = imports.mainloop;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

let _httpSession;

const EcobeeApi = new GObject.Class({
  Name: 'SmartThermostat.EcobeeApi',
  GTypeName: 'SmartThermostatEcobeeApi',

  _init: function(params) {
    this.parent(params);

		// Create user-agent string from uuid and (if present) the version
    this.user_agent = Me.metadata.uuid;
    if (Me.metadata.version !== undefined && Me.metadata.version.toString().trim() !== '') {
    	this.user_agent += '/';
      this.user_agent += Me.metadata.version.toString();
    }
    // add trailing space, so libsoup adds its own user-agent
    this.user_agent += ' ';

    this.loadConfig();
  },

  refreshPin: function() {
		Mainloop.source_remove(this._authWatch);
	  let response = this.load_json(ECOBEE_API_URL + '/authorize',
			{ response_type: 'ecobeePin', client_id: ECOBEE_API_KEY, 
				scope: 'smartWrite' }, 'GET');
		this.pinExpires = (response.expires_in*60)+Math.round(+new Date()/1000);
		this.pin = response.ecobeePin;
		this.pinInterval = response.interval;
		this.authCode = response.code;
		this._authWatch = Mainloop.timeout_add_seconds(this.pinInterval,
			Lang.bind(this, this.getTokens));
    return this.pin;
  },

	getTokens: function() {
		if (!this.pin || !this.authCode) {
      return false;;
    }
    let response = this.load_json(ECOBEE_API_URL + '/token',
      { grant_type: 'ecobeePin', 'code': this.authCode,
        client_id: ECOBEE_API_KEY }, 'POST');
    if (response.access_token) {
      this.accessToken = response.access_token;
      this.refreshToken = response.refresh_token;
      this.accessTokenExpires = Math.round(+new Date()/1000) + (60*60);
      this.refreshTokenExpires = Math.round(+new Date()/1000) + (60*60*24*365);
			return false;
    }
		return true;
	},

  get pin() {
    if (this.Settings.get_string('ecobee-pin') && 
			(this.pinExpires < Math.round(+new Date()/1000))) {
      this.Settings.set_string('ecobee-pin', '');
    }
    return this.Settings.get_string('ecobee-pin');
  },

  set pin(v) {
    this.Settings.set_string('ecobee-pin', v);
  },

  get pinExpires() {
    return this.Settings.get_int('ecobee-pin-expires');
  },
  
  set pinExpires(v) {
    this.Settings.set_int('ecobee-pin-expires', v);
  },

  get pinInterval() {
    return this.Settings.get_int('ecobee-pin-interval');
  },

  set pinInterval(v) {
    this.Settings.set_int('ecobee-pin-interval', v);
  },

  get authCode() {
    if (this.Settings.get_string('ecobee-auth-code') &&
      (this.pinExpires < Math.round(+new Date()/1000))) {
      this.Settings.set_string('ecobee-auth-code', '');
    }
    return this.Settings.get_string('ecobee-auth-code');
  },

  set authCode(v) {
    this.Settings.set_string('ecobee-auth-code', v);
  },

  get refreshToken() {
    if (this.Settings.get_string('ecobee-refresh-token') && 
			(this.refreshTokenExpires < Math.round(+new Date()/1000))) {
      this.Settings.set_string('ecobee-refresh-token', '');
    }
    return this.Settings.get_string('ecobee-refresh-token');
  },

  set refreshToken(v) {
    this.Settings.set_string('ecobee-refresh-token', v);
  },

  get refreshTokenExpires() {
    return this.Settings.get_int('ecobee-refresh-token-expires');
  },
 
  set refreshTokenExpires(v) {
    this.Settings.set_int('ecobee-refresh-token-expires', v);
  },

  get accessToken() {
    if (this.refreshToken &&
			(this.accessTokenExpires < Math.round(+new Date()/1000))) {
      this.Settings.set_string('ecobee-access-token', '');
		  let response = this.load_json(ECOBEE_API_URL + '/token',
  		  { grant_type: 'refresh_token', 'code': this.refreshToken,
          client_id: ECOBEE_API_KEY }, 'POST');
			if (response.access_token) {
				this.accessToken = response.access_token;
				this.accessTokenExpires = Math.round(+new Date()/1000) + (60*60);
        this.refreshToken = response.refresh_token;
        this.refreshTokenExpires = Math.round(+new Date()/1000) + (60*60*24*365);
			} else {
				this.accessToken = '';
			}
    }
    return this.Settings.get_string('ecobee-access-token');
  },

  set accessToken(v) {
    this.Settings.set_string('ecobee-access-token', v);
  },

  get accessTokenExpires() {
    return this.Settings.get_int('ecobee-access-token-expires');
  },

  set accessTokenExpires(v) {
    this.Settings.set_int('ecobee-access-token-expires', v);
  },

	isConnected: function() {
		if (this.accessToken) {
			return true;
		}
		return false;
	},

	pollThermostats: function() {
		//if (!this._thermostats) {
			this.refreshThermostats();
    //}
		return this._thermostats;
	},

	refreshThermostats: function() {
		let response = this.load_json(ECOBEE_API_URL + 
			'/1/thermostat', {json: '\{"selection":\{"includeAlerts":"true","selectionType":"registered","selectionMatch":"","includeEvents":"true","includeSettings":"true","includeRuntime":"true","includeEquipmentStatus":"true"\}\}'}, 'GET', { 'Content-Type': 'text/json;charset=UTF-8', 'Authorization': 'Bearer ' + this.accessToken});
		this._thermostats = {};
		for each (let tstat in response.thermostatList) {
			this._thermostats[tstat.identifier] = {
				name: tstat.name,
        primary: true,
			  actualTemp: tstat.runtime.actualTemperature,
        desiredTemp: tstat.runtime.desiredHeat,
        mode: tstat.settings.hvacMode,
        heating: false,
        cooling: false,
        humidifying: false
			}
      let equipStatus = tstat.equipmentStatus.split(',');
      for each (let statusItem in equipStatus) {
        switch (statusItem) {
          case 'heatPump':
          case 'heatPump2':
          case 'heatPump3':
          case 'auxHeat1':
          case 'auxHeat2':
          case 'auxHeat3':
            this._thermostats[tstat.identifier].heating = true;
            break;
        }
      }
		}
	},

  loadConfig: function() {
    this.Settings = Convenience.getSettings('org.gnome.shell.extensions.smartthermostat');
  },

  load_json: function(url, params, method = 'POST', headers = {}) {
    if (_httpSession === undefined) {
      _httpSession = new Soup.Session();
      _httpSession.user_agent = this.user_agent;
    } else {
      // abort previous requests.
  	  _httpSession.abort();
	  }
		let message = Soup.form_request_new_from_hash(method, url, params);
		/*if (this.accessToken && (this.accessToken != 'refreshing')) {
			message.request_headers.append('Content-Type', 'text/json;charset=UTF-8');;
			message.request_headers.append('Authorization', 
				'Bearer ' + this.accessToken);
		}*/
    for (var header in headers) {
      message.request_headers.append(header, headers[header]);
    }
		_httpSession.send_message(message);
		return JSON.parse(message.response_body.data);
  }
});

function initEcobeeApi() {
  let ecobeeApi = new EcobeeApi();
  return ecobeeApi;
}
