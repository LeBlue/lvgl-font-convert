'use strict';

const AppError = require('make-error')('AppError');
const path     = require('path');

// function unicode_to_utf8_cstring(num) {
//   if (num <= 0) {
//     throw new AppError(`Invalid unicode number: ${num}`);
//   } else if (num < 127) {
//     return `"\\x${num.toString(16)}`;
//   } else if (num < )
// }

function hexstr(n) {
  return n.toString(16).padStart(2, "0");
}

function unicode_to_utf8_cstring(unicode) { // adapted from https://gist.github.com/volodymyr-mykhailyk/2923227
	var b = [];
  // unicode = str.charCodeAt(i);
  // 0x00000000 - 0x0000007f -> 0xxxxxxx
  if (unicode <= 0x7f) {
    b.push(hexstr(unicode));
    // 0x00000080 - 0x000007ff -> 110xxxxx 10xxxxxx
  } else if (unicode <= 0x7ff) {
    b.push((unicode >> 6) | 0xc0);
    b.push((unicode & 0x3F) | 0x80);
    // 0x00000800 - 0x0000ffff -> 1110xxxx 10xxxxxx 10xxxxxx
  } else if (unicode <= 0xffff) {
    b.push(hexstr((unicode >> 12) | 0xe0));
    b.push(hexstr(((unicode >> 6) & 0x3f) | 0x80));
    b.push(hexstr((unicode & 0x3f) | 0x80));
    // 0x00010000 - 0x001fffff -> 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
  } else {
    b.push(hexstr((unicode >> 18) | 0xf0));
    b.push(hexstr(((unicode >> 12) & 0x3f) | 0x80));
    b.push(hexstr(((unicode >> 6) & 0x3f) | 0x80));
    b.push(hexstr((unicode & 0x3f) | 0x80));
  }

  return `"\\x${b.join("\\x")}"`;
}

function symbol_name(prefix, name)
{
  if (prefix) {
    return `${prefix.toUpperCase()}_${name.toUpperCase()}`;
  }
  return `${name.toUpperCase()}`;
}

module.exports.generate = function (defines) {

  if (!defines.header) {
    throw new AppError("Missing config key for defines: 'header'");
  }
  if (!defines.header.endsWith(".h")) {
    defines.header = `${defines.header}.h`;
  }
  let header_file = path.basename(defines.header);
  let prefix = defines.prefix || "";
  let include_prefix = defines.include_prefix || "_"
  const header_sym = header_file.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_");
  // add _ to make sure it is different than guard_name (needed?)
  let inc_guard =  `${include_prefix}${header_sym}_`;
  let guard_name =  header_sym;

  let symdefs = []
  let enums = []

  for (let k of Object.keys(defines.names)) {
    let code = defines.names[k];
    let str = unicode_to_utf8_cstring(code);
    let sym = symbol_name(prefix, k);
    symdefs.push(`/* 0x${code.toString(16).toUpperCase()} */`);
    symdefs.push(`#define ${sym} ${str}`);
    symdefs.push("");
    enums.push(`    _${sym}`);
  };

  // add end marker to enum
  enums.push(`    _${symbol_name(prefix, "NUM_")}`);

  return `/*******************************************************************************
 * File: ${header_file}
 * Prefix: ${prefix}
 ******************************************************************************/
#ifndef ${inc_guard}
#define ${inc_guard}


#ifdef LV_LVGL_H_INCLUDE_SIMPLE
#include "lvgl.h"
#else
#include "${defines.lv_include || 'lvgl/lvgl.h'}"
#endif

#ifndef ${guard_name}
#define ${guard_name} 1
#endif

#ifdef __cplusplus
extern "C"
#endif

#if ${guard_name}

${symdefs.join("\n")}

enum ${guard_name}_E {
${enums.join(",\n")}
};

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /* #if ${guard_name} */

#endif /* #ifdef ${inc_guard} */

`;
};