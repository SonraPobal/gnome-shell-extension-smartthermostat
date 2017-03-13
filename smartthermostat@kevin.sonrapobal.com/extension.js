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
      global.log('polled');
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
    for each (let tstat in this._thermostats) {
      let item = new PopupMenu.PopupBaseMenuItem();
      item._label = tstat.name;
      item._labelActor = new St.Label({text: tstat.name });
      item.actor.add(item._labelActor, {x_fill: true, expand: true});
      item._valueLabel = new St.Label({text: Math.round(tstat.actualTemp/10,1).toString()+'°'});
      if (tstat.heating) {
        item._valueLabel.set_style('color: rgb(243, 138, 0)');
      }
      item.actor.add(item._valueLabel);
      item._desireLabel = new St.Label({text: '(' + Math.round(tstat.desiredTemp/10,1).toString()+'°)'});
      item.actor.add(item._desireLabel);
      this.menu.addMenuItem(item);

      if (tstat.primary) {
        this._primaryActualTemp.set_text(Math.round(tstat.actualTemp/10,1).toString()+'°');
        if (tstat.heating) {
          this._primaryActualTemp.set_style('color: rgb(243, 138, 0)');
        } else {
          this._primaryActualTemp.set_style('color: inherit');
        }
        this._primaryDesiredTemp.set_text(' (' + Math.round(tstat.desiredTemp/10,1).toString() + '°)');
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
