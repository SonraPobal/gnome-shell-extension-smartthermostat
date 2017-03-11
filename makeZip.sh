#!/bin/sh
NAME=smartthermostat@kevin.sonrapobal.com
cd $NAME
zip -r $NAME.zip *
cd ..
mv $NAME/$NAME.zip 
