// Parse input arguments and execute convertor

'use strict';


const argparse    = require('argparse');
const fs          = require('fs');
const mkdirp      = require('mkdirp');
const path        = require('path');
const yaml        = require('js-yaml');
const { exit }    = require('process');
const symbols     = require('./symbols.js');
const lvgl_writer = require('lv_font_conv/lib/writers/lvgl')
const collect_font_data = require('lv_font_conv/lib/collect_font_data');
const AppError = require('make-error')('AppError');

// these are internal APIs, need to use them
const lv_writers = {
  dump: require('lv_font_conv/lib/writers/dump'),
  bin: require('lv_font_conv/lib/writers/bin'),
  lvgl: require('lv_font_conv/lib/writers/lvgl')
};


// Formatter with support of `\n` in Help texts.
class RawTextHelpFormatter2 extends argparse.RawDescriptionHelpFormatter {
  // executes parent _split_lines for each line of the help, then flattens the result
  _split_lines(text, width) {
    return [].concat(...text.split('\n').map(line => super._split_lines(line, width)));
  }
}

function make_filename(str, ext) {
  const re = /[^a-z0-9]/g;
  if (ext && ext.length > 0 && str.length > ext.length) {
    if (str.endsWith(ext)) {
      str = str.slice(0, -1 * ext.length);
      console.log("Header:", str);
    }
  } else {
    ext = "";
  }
  return `${str.toLowerCase().replaceAll(re, "_")}${ext}`;
}


// parse decimal or hex code in unicode range
function unicode_point(str) {
  let m = /^(?:(?:0x([0-9a-f]+))|([0-9]+))$/i.exec(str.trim());

  if (!m) throw new TypeError(`${str} is not a number`);

  let [ , hex, dec ] = m;

  let value = hex ? parseInt(hex, 16) : parseInt(dec, 10);

  if (value > 0x10FFFF) throw new TypeError(`${str} is out of unicode range`);

  return value;
}


// parse range
function range(str) {
  let result = [];
  if (!str) {
    throw new AppError("Range is empty or undefined");
  }

  for (let s of str.split(',')) {
    let m = /^(.+?)(?:-(.+?))?(?:=>(.+?))?$/i.exec(s);

    let [ , start, end, mapped_start ] = m;

    if (!end) end = start;
    if (!mapped_start) mapped_start = start;

    start = unicode_point(start);
    end = unicode_point(end);

    if (start > end) throw new TypeError(`Invalid range: ${s}`);

    mapped_start = unicode_point(mapped_start);

    result.push(start, end, mapped_start);
  }

  return result;
}


// exclude negative numbers and non-numbers
function positive_int(str) {
  if (!/^\d+$/.test(str)) throw new TypeError(`${str} is not a valid number`);

  let n = parseInt(str, 10);

  if (n <= 0) throw new TypeError(`${str} is not a valid number`);

  return n;
}



module.exports.run = async function (argv, debug = false) {

  //
  // Configure CLI
  //

  let parser = new argparse.ArgumentParser({
    add_help: true,
    formatter_class: RawTextHelpFormatter2
  });

  if (debug) {
    parser.exit = function (status, message) {
      throw new Error(message);
    };
  }

  parser.add_argument('-v', '--version', {
    action: 'version',
    version: require('../package.json').version
  });

  parser.add_argument('-o', '--output', {
    metavar: '<path>',
    help: 'Output path.'
  });

  parser.add_argument('--config', {
    metavar: '<file>',
    help: 'Output path.',
    required: true,
    help: 'Config file with parameters for font conversion.'
  });

  parser.add_argument('--verbose', {
    action: 'store_true',
    help: 'Print more output while converting'
  })

  //
  // Process CLI options
  //
  let args = parser.parse_args(argv.length ? argv : [ '-h' ]);

  // Get config, or throw exception on error
  try {
    var config = fs.readFileSync(args.config, 'utf8');
  } catch (err) {
    throw new AppError(`Cannot read file "${args.config}": ${err.message}`);
  }

  try {
    var imports = yaml.load(config);
  } catch (err) {
    throw new AppError(`Failed to load config: ${args.config}: ${err.message}`);
  }

  let outputdir = args.output || ".";

  if (args.verbose) {
    console.log(imports);
    console.log(imports.fonts)
  };

  // process options forn symbol name defines
  let defines = imports.defines;
  defines.names = {};
  defines.header = path.join(outputdir, make_filename(defines.header, ".h"));


  // fonts relative to config file
  let fontdir = path.dirname(args.config);
  // append named symbols to ranges
  for (let font of imports.fonts) {
    font.source_path = path.join(fontdir, font.source_path);
    if (args.verbose) console.log(`Pre-processing: ${font.source_path}`);

    // Append named symbols to import ranges
    if (font.named) {
      Object.keys(font.named).forEach(k => {
        font.ranges.push(font.named[k]);
        defines.names[k] = range(font.named[k])[2];
      });
    };

    // convert ranges to integers
    let ranges = font.ranges;
    font.ranges = [];
    try {
      ranges.forEach(r => {font.ranges.push({"range": range(r)})});
    } catch (err) {
      throw new AppError(`Failed to read ranges/named of ${font.source_path}: ${err.message}`);
    };
  };

  //
  // Convert for all sizes
  //
  for (let size of imports.sizes) {
    let format = imports.format || "lvgl"

    // collect arguments
    var font_collect_args = {
      "font": imports.fonts,
      "size": size,
      "bbp": imports.bbp,
    };
    const cl_flags = ["lcd", "lcd_v", "use_color_info", "auto_hint_off", "auto_hint_strong", "no_kerning"]
    cl_flags.forEach(f => {font_collect_args[f] = imports[f] || false })

    // Convert, load font data
    //
    for (let font of imports.fonts) {
      console.log(`Reading File: ${font.source_path}`);

      try {
        font.source_bin = fs.readFileSync(font.source_path);
      } catch (err) {
        throw new AppError(`Cannot read file "${font.source_path}": ${err.message}`);
      }
    }

    let font_data = await collect_font_data(font_collect_args)

    if (!Object.keys(lv_writers).includes(format)) {
      throw new AppError(`Invalid or unsupported format: ${format}`);
    }

    // only proper extension with "lvgl" output
    let extension = (format === "lvgl") ? ".c" : ""
    let outname = `${make_filename(imports.name)}_${size}${extension}`;

    // writer arguments
    var writer_args = {
      "bpp": imports.bbp,
      "lv_include": imports.lv_include || undefined,
      "output": path.join(outputdir, outname),
      "size": size,
    };
    const w_flags = ["no_kerning", "no_compress", "no_prefilter"]
    w_flags.forEach(f => {writer_args[f] = imports[f] || false });

    if (args.verbose) {
      for (let font of imports.fonts) {
        console.log(`Exporting (${size}):`, font.source_path);
        // console.log("Ranges:", font.ranges);
        if (font.symbols) {
          console.log("Symbols:", font.symbols);
        };
      };
    };
    let files = lv_writers[format](writer_args, font_data);

    for (let [ filename, data ] of Object.entries(files)) {
      let dir = path.dirname(filename);
      console.log("Writing File:  ", filename);

      mkdirp.sync(dir);
      fs.writeFileSync(filename, data);
    };
  };

  let header_data = symbols.generate(defines);
  console.log("Writing Header:", defines.header);

  fs.writeFileSync(defines.header, header_data);

  exit(0);
};
