#!/bin/sh

NAME=smartthermostat@kevin.sonrapobal.com
rm -rf ~/.local/share/gnome-shell/extensions/$NAME
cp -r $NAME ~/.local/share/gnome-shell/extensions/.
