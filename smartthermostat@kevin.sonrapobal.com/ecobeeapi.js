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
    if (!this._thermostats) {
      this._thermostats = {};
      this.refreshThermostats();
    } else {
      let response = this.load_json(ECOBEE_API_URL +
        '/1/thermostatSummary', {json: '\{"selection":\{"selectionType":"registered","selectionMatch":""\}\}'}, 'GET', { 'Content-Type': 'text/json;charset=UTF-8', 'Authorization': 'Bearer ' + this.accessToken});
      for each (let tstatus in response.revisionList) {
        let runtime, settings;
        runtime = settings = false;
        tstatus = tstatus.split(':');
        if (typeof this._thermostats[tstatus[0]] == 'undefined') {
          this.refreshThermostats([tstatus[0]]);
          continue;
        }
        if (this._thermostats[tstatus[0]].runtimeRev != tstatus[5]) {
          runtime = true;
        }
        if (this._thermostats[tstatus[0]].thermostatRev != tstatus[3]) {
          settings = true;
        }
        if (settings || runtime) {
          this.refreshThermostats([tstatus[0]], runtime, settings);
        }
      }
    }
    return this._thermostats;
  },

  refreshThermostats: function(tstat_ids = [], runtime = true, 
    settings = true) {
    let request = {
      selection: {
        'includeEquipmentStatus': true
      }
    };
    if (tstat_ids.length > 0) {
      request.selection.selectionType = 'thermostats';
      request.selection.selectionMatch = tstat_ids.join(",");
    } else {
      request.selection.selectionType = 'registered';
      request.selection.selectionMatch = '';
    }
    if (runtime) {
      request.selection.includeRuntime = true;
      request.selection.includeSensors = true;
    }
    if (settings) {
      request.selection.includeSettings = true;
    }
    let response = this.load_json(ECOBEE_API_URL + 
      '/1/thermostat', {json: JSON.stringify(request)}, 'GET', { 'Content-Type': 'text/json;charset=UTF-8', 'Authorization': 'Bearer ' + this.accessToken});
    for each (let tstat in response.thermostatList) {
      if (typeof this._thermostats[tstat.identifier] == 'undefined') {
        this._thermostats[tstat.identifier] = {
          name: tstat.name,
          primary: true,
          heating: false,
          cooling: false,
          humidifying: false,
          remoteSensors: {}
        }
      }
      this._thermostats[tstat.identifier].thermostatRev = tstat.thermostatRev;
      if (settings) {
        this._thermostats[tstat.identifier].mode = tstat.settings.hvacMode;
				this._thermostats[tstat.identifier].forcedAir = 
					tstat.settings.hasForcedAir;
				this._thermostats[tstat.identifier].fanControl =
					tstat.settings.fanControlRequired;
      }
      if (runtime) {
        this._thermostats[tstat.identifier].runtimeRev = 
          tstat.runtime.runtimeRev;
        this._thermostats[tstat.identifier].actualTemp =
          tstat.runtime.actualTemperature;
        this._thermostats[tstat.identifier].desiredTemp =
          tstat.runtime.desiredHeat;
        this._thermostats[tstat.identifier].actualHumidity =
          tstat.runtime.actualHumidity;
        this._thermostats[tstat.identifier].desiredHumidity =
          tstat.runtime.desiredHumidity;
        for each (let sensor in tstat.remoteSensors) {
          if (typeof this._thermostats[tstat.identifier].remoteSensors[sensor.id] == 'undefined') {
            this._thermostats[tstat.identifier].remoteSensors[sensor.id] = {
              name: sensor.name
            };
            for each (let data in sensor.capability) {
              this._thermostats[tstat.identifier].remoteSensors[sensor.id][data.type] = data.value;
            }
          }
        }
      }
      this.updateEquipmentStatus(tstat.identifier, tstat.equipmentStatus);
    }
  },

  updateEquipmentStatus: function(tstat_id, equip_status) {
    this._thermostats[tstat_id].heating =
    this._thermostats[tstat_id].cooling =
    this._thermostats[tstat_id].fan =
    this._thermostats[tstat_id].humidifying = false;
    let equipStatus = equip_status.split(',');
    for each (let statusItem in equipStatus) {
      switch (statusItem) {
        case 'heatPump':
        case 'heatPump2':
        case 'heatPump3':
        case 'auxHeat1':
        case 'auxHeat2':
        case 'auxHeat3':
          this._thermostats[tstat_id].heating = true;
					if ((this._thermostats[tstat_id].forcedAir == "true") &&
						(this._thermostats[tstat_id].fanControl != "true")) {
						this._thermostats[tstat_id].fan = true;
					}
          break;
        case 'compCool1':
        case 'compCool2':
          this._thermostats[tstat_id].cooling = true;
          break;
        case 'fan':
        case 'ventilator':
          this._thermostats[tstat_id].fan = true;
          break;
        case 'humidifier':
        case 'dehumidifier':
          this._thermostats[tstat_id].humidifying = true;
          break;
      }
    }
  },

  destroy: function() {
    Mainloop.source_remove(this._authWatch);
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
