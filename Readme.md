lvgl-font-converter
===================

Helper script for converting fonts to lvgl c files base on configuration files.
Wrapper for [lv_font_conv](https://github.com/lvgl/lv_font_conf).


## Usage

Create a config file, example

```
format: "lvgl"
bbp: 4
sizes: [ 16, 24 ]
# how outout will be called
name: "FontAwesome Solid"
fonts:
  # can add multpile here, ranges/symbols must not overlap, or remapped with =>0x...
  - source_path: "fonts/fa-solid-900.ttf"
    symbols: ""
    ranges: []
    #  - "0x20-0x7f"
    named:
      sliders: "0xf1de"


# config to generate #defines for utf-8 string (named key above)
defines:
  # how header will be called
  header: "fa_solid_symbols.h"
  prefix: "symbol"
```

Call the script, give a config file and a output directory

```
export PATH="${PATH}:$(pwd)/node_modules/.bin/"
node lvgl-font-converter --config config.yaml --output some/path
```

## Install

In the root of this sources run `npm install`.

