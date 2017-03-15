const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const EcobeeApi = Me.imports.ecobeeapi;

const modelColumn = {
  label: 0,
  separator: 1
}

function init() {
  // Don't do a damn thing but it is required.
}

const SmartThermostatPrefsWidget = new GObject.Class({
  Name: 'SmartThermostat.Prefs.Widget',
  GTypeName: 'SmartThermostatPrefsWidget',
  Extends: Gtk.Grid,

  _init: function(params) {
    this.parent(params);

    this.Settings = Convenience.getSettings('org.gnome.shell.extensions.smartthermostat');

    this.margin = this.row_spacing = this.column_spacing = 20;
    this.ecobeeApi = EcobeeApi.initEcobeeApi();

    this._settings = Convenience.getSettings();

    let i = 0;

    this.attach(new Gtk.Label({ label: 'Poll Thermostat Every (min)', halign : Gtk.Align.END}), 0, i, 1, 1);
    let updateTime = Gtk.SpinButton.new_with_range (3, 60, 1);
    this.attach(updateTime, 1, i++, 1, 1);
    this._settings.bind('update-time', updateTime, 'value', Gio.SettingsBindFlags.DEFAULT);

    this._addComboBox({
      items : {centigrade : "\u00b0C", fahrenheit : "\u00b0F"},
      key: 'unit', y : i++, x : 0,
      label: 'Temperature Unit'
    });

    this._addComboBox({
      items : {left : 'Left', center : 'Center', right : 'Right'},
      key: 'position-in-panel', y : i++, x : 0,
      label: 'Position in Panel'
    });

    this.attach(new Gtk.Label({ label: 'Ecobee PIN:', halign: Gtk.Align.END }), 0, i, 1, 1);
    this._ecobeePin = new Gtk.Label({ label: this.ecobeeApi.pin });
    this._ecobeePin.set_selectable(true);
    this.attach(this._ecobeePin, 1, i, 1, 1);

    let ecobeeRefreshPin = new Gtk.Button({ label: 'Request PIN' });
    this.attach(ecobeeRefreshPin, 2, i++, 1, 1);
    ecobeeRefreshPin.connect('clicked', Lang.bind(this, function(btn) {
      btn.set_sensitive(false);
      this.ecobeeApi.refreshPin();
      btn.set_sensitive(true);
    }));

    this._ecobeePinReadme = new Gtk.Label({ label: '' });
    this._ecobeePinReadme.set_line_wrap(true);
    this.attach(this._ecobeePinReadme, 0, i++, 3, 1);

    this.attach(new Gtk.Label({ label: 'Ecobee Status:', halign: Gtk.Align.END }), 0, i, 1, 1);
    this._ecobeeStatus = new Gtk.Label({ label: '' });
    this.attach(this._ecobeeStatus, 1, i++, 1, 1);

    this.Settings.connect('changed::ecobee-pin', Lang.bind(this, 
      function() {
      this._ecobeePin.set_label(this.ecobeeApi.pin);
      if (this.ecobeeApi.pin) {
        this._ecobeePinReadme.set_markup('<a href="https://www.ecobee.com/consumerportal/index.html#/my-apps/add/new">Log in to your Ecobee account</a> and add an application under My Apps using the PIN above to authorize Smart Thermostat.');
      } else {
        this._ecobeePinReadme.set_label('');
      }
      }));
    this.Settings.connect('changed::ecobee-refresh-token',
      Lang.bind(this, this.checkEcobeeStatus));
    this.checkEcobeeStatus();
  },

  checkEcobeeStatus: function() {
    let refresh_token = this.ecobeeApi.refreshToken;
    let access_token = this.ecobeeApi.accessToken;
    if (refresh_token && access_token) {
    this._ecobeeStatus.set_markup('<span foreground="green" weight="bold">Connected</span>');
    } else {
    this._ecobeeStatus.set_markup('<span foreground="red" style="italic">Not Authorized</span>');
    }
  },

  _addSwitch : function(params){
    let lbl = new Gtk.Label({label: params.label,halign : Gtk.Align.END});
    this.attach(lbl, params.x, params.y, 1, 1);
    let sw = new Gtk.Switch({halign : Gtk.Align.END, valign : Gtk.Align.CENTER});
    this.attach(sw, params.x + 1, params.y, 1, 1);
    if(params.help){
      lbl.set_tooltip_text(params.help);
      sw.set_tooltip_text(params.help);
    }
    this._settings.bind(params.key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
  },

  _addComboBox : function(params){
    let model = new Gtk.ListStore();
    model.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING]);

    let combobox = new Gtk.ComboBox({model: model});
    let renderer = new Gtk.CellRendererText();
    combobox.pack_start(renderer, true);
    combobox.add_attribute(renderer, 'text', 1);

    for(let k in params.items){
      model.set(model.append(), [0, 1], [k, params.items[k]]);
    }

    combobox.set_active(Object.keys(params.items).indexOf(this._settings.get_string(params.key)));
    
    combobox.connect('changed', Lang.bind(this, function(entry) {
      let [success, iter] = combobox.get_active_iter();
      if (!success)
        return;
      this._settings.set_string(params.key, model.get_value(iter, 0))
    }));

    this.attach(new Gtk.Label({ label: params.label, halign : Gtk.Align.END}), params.x, params.y, 1, 1);
    this.attach(combobox, params.x + 1, params.y, 1, 1);
  }

});

function buildPrefsWidget() {
  let w = new SmartThermostatPrefsWidget();
  w.show_all();
  return w;
}
