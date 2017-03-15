const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const EcobeeApi = Me.imports.ecobeeapi;

const SmartThermostatButton = new Lang.Class({
  Name: 'SmartThermostatButton',
  Extends: PanelMenu.Button,

  _init: function() {
    this.parent(St.Align.START);

    this.ecobeeApi = EcobeeApi.initEcobeeApi();

    this._settings = Convenience.getSettings();

    this._menuLayout = new St.BoxLayout();
    this._initialIcon = new St.Icon({style_class: 'system-status-icon'});
    this._initialIcon.gicon = Gio.icon_new_for_string(Me.path +
      '/icons/thermostat-icon.svg');
    this._menuLayout.add(this._initialIcon);

    this.actor.add_actor(this._menuLayout);

    this._primaryActualTemp = new St.Label({ text: '0°', y_expand: true,
      y_align: Clutter.ActorAlign.CENTER });
    this._primaryDesiredTemp = new St.Label({ text: ' (0°)', y_expand: true,
      y_align: Clutter.ActorAlign.CENTER });
    this._menuLayout.add(this._primaryActualTemp);
    this._menuLayout.add(this._primaryDesiredTemp);

    this._settingChangedSignals = [];
    this._addSettingChangedSignal('update-time', Lang.bind(this, this._updateTimeChanged));
    this._addSettingChangedSignal('unit', Lang.bind(this, this._updateDisplay));

    this.connect('destroy', Lang.bind(this, this._onDestroy));

    this._needRerender = true;
    this._queryThermostats();

    this._addTimer();
  },

  _addSettingChangedSignal : function(key, callback){
    this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
  },

  _updateTimeChanged: function() {
    Mainloop.source_remove(this._timeoutId);
    this._addTimer();
  },

  _addTimer: function() {
    this._timeoutId = Mainloop.timeout_add_seconds(this._settings.get_int('update-time')*60, Lang.bind(this, function (){
      this._queryThermostats();
      return true;
    }));
  },

  _onDestroy: function() {
    this.ecobeeApi.destroy();
    delete this.ecobeeApi;
    Mainloop.source_remove(this._timeoutId);
    for each (let signal in this._settingChangedSignals){
      this._settings.disconnect(signal);
    };
  },

  _queryThermostats: function() {
    // Get latest values from thermostat and update display
    if (this.ecobeeApi.isConnected()) {
      this._thermostats = this.ecobeeApi.pollThermostats();
    } else {
      this._thermostats = {};
    }
    this._updateDisplay();
  },

  _updateDisplay: function() {
    this._needRerender = false;
    this.menu.removeAll();
    this._appendMenuItems();
  },

  _appendMenuItems: function() {
    if (!Object.keys(this._thermostats).length) {
      let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
      item.actor.add_actor(new St.Label({text: 'No thermostats available.  Please check your settings.'}));
      this.menu.addMenuItem(item);
    }
    for each (let tstat in this._thermostats) {
      let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
      let tstat_summary = new St.Bin();
      item.actor.add_actor(tstat_summary);
      let box = new St.BoxLayout({ 
        style_class: 'smartthermostat-details-box' 
      });
      tstat_summary.set_child(box);

      let tstatNameContainer = new St.BoxLayout();
      let tstatName = new St.Label({ text: tstat.name, 
        style_class: 'smartthermostat-name' });
      let tstatActual = new St.Label({ text: this.formatTemp(tstat.actualTemp),
        style_class: 'smartthermostat-temp-actual smartthermostat-temp',  
        y_align: Clutter.ActorAlign.END });
      if (tstat.heating) {
        tstatActual.add_style_class_name('smartthermostat-temp-heating');
      }
      tstatNameContainer.add_actor(tstatName);
      tstatNameContainer.add_actor(tstatActual);
      tstatNameContainer.add_actor(new St.Label( { text: '(' +
        this.formatTemp(tstat.desiredTemp) + ')',
          style_class: 'smartthermostat-temp-desired smartthermostat-temp',
          y_align: Clutter.ActorAlign.END }));
      let bb = new St.BoxLayout({ vertical: true, 
        style_class: 'system-menu-action smartthermostat-tstat-summary' });
      bb.add_actor(tstatNameContainer);

      let humidityContainer = new St.BoxLayout();
      humidityContainer.add_actor(new St.Label({ text: 'Humidity: ' }));
      let actualHumidity = 
        new St.Label({ text: tstat.actualHumidity.toString() + '%' });
      if (tstat.humidifying) {
        actualHumidity.add_style_class_name('smartthermostat-misc-on');
      }
      humidityContainer.add_actor(actualHumidity);
      humidityContainer.add_actor(new St.Label({ text: ' (' +
        tstat.desiredHumidity.toString() + '%)' }));
      bb.add_actor(humidityContainer);

      let fanStatusContainer = new St.BoxLayout();
      fanStatusContainer.add_actor(new St.Label({ text: 'Fan: ' }));
      let fanStatus = new St.Label({ text: 'Off' });
      if (tstat.fan) {
        fanStatus.set_text('On');
        fanStatus.add_style_class_name('smartthermostat-misc-on');
      }
      fanStatusContainer.add_actor(fanStatus);
      fanStatusContainer.add_actor(new St.Label({ text: ' (' + 
        tstat.fanMode + ')' }));
      bb.add_actor(fanStatusContainer);
      box.add_actor(bb);

      if (Object.keys(tstat.remoteSensors).length > 1) {
        let sensorContainer = new St.BoxLayout({ vertical: true,
          style_class: 'smartthermostat-sensors' });
        for each (let sensor in tstat.remoteSensors) {
          let sensorLabel = new St.Label({ text: sensor.name + ': ' +
            this.formatTemp(sensor.temperature), 
            style_class: 'smartthermostat-sensor' });
          if (sensor.occupancy == "true") {
            sensorLabel.add_style_class_name('smartthermostat-sensor-occupied');
          }
          sensorContainer.add_actor(sensorLabel);
        }
        box.add_actor(sensorContainer);
      }

      this.menu.addMenuItem(item);

      if (tstat.primary) {
        this._primaryActualTemp.set_text(this.formatTemp(tstat.actualTemp));
        if (tstat.heating) {
          this._primaryActualTemp.set_style('color: rgb(243, 138, 0)');
        } else {
          this._primaryActualTemp.set_style('color: inherit');
        }
        this._primaryDesiredTemp.set_text(' (' + 
          this.formatTemp(tstat.desiredTemp) + ')');
      }
    }

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    let item = new PopupMenu.PopupBaseMenuItem();
    item.actor.add(new St.Label({ text: _("Settings") }), { expand: true, x_fill: false });

    item.connect('activate', function () {
      Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
    });

    this.menu.addMenuItem(item);
  },

  formatTemp: function(val) {
    if (this._settings.get_string('unit') == 'fahrenheit') {
      return (val/10).toString()+' °F';
    }
    return (Math.round((((val-320)*5)/90)*10)/10).toString()+' °C';
  },

  get positionInPanel() {
    return this._settings.get_string('position-in-panel');
  }
});

let smartThermostat;

function init(extensionMeta) {
}

function enable() {
  smartThermostat = new SmartThermostatButton();
  let positionInPanel = smartThermostat.positionInPanel;
  Main.panel.addToStatusArea('smartThermostat', smartThermostat,
    positionInPanel == 'right' ? 0 : -1, positionInPanel);
}

function disable() {
  smartThermostat.destroy();
  smartThermostat = null;
}
