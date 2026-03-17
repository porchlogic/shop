// parsed main.yaml document
const yaml = {};

// list of supported HTML elements (h1, p, a, etc)
const html_elements = {
  h1: true,
  h2: true,
  p: true,
  a: true,
};

// html chunk / file–based modules (carousel, row, etc)
const html_modules = {
  // carousel: true,
  // row: true,
};


function parseSite() {
  // for each page mapping in yaml.pages
  for (const route in yaml.pages) {

    // generate the respective html file for this route
    const page_modules = yaml.pages[route];

    // each page is a list of modules
    for (const page_module of page_modules) {

      // page_module is an object with a single key
      // e.g. { product_page: { data: {...} } }
      const module_name = Object.keys(page_module)[0];
      const module_args = page_module[module_name];

      // parse the module with its input data
      parseModule(module_name, module_args);
    }
  }
}

function parseModule(name, input) {

  // get the module definition from yaml.modules
  const module_def = yaml.modules[name];
  if (!module_def) return;

  // input.data contains the raw values passed to the module
  // e.g. { product: "m8_plate_1" }
  const raw_data = input?.data || {};

  // create a new resolved scope for this module
  // this is where lookups like content.products are resolved
  const resolved_scope = resolveData(module_def.data, raw_data);

  // determine which child modules to render
  // a module can either:
  // - be a list itself
  // - or have a `modules` list
  const modules = module_def.modules || [];

  for (const item of modules) {

    // each item is either:
    // - an html element
    // - a html module
    // - another yaml module
    const item_name = Object.keys(item)[0];
    const item_value = item[item_name];

    // if item is a simple html element (h1, p, a, etc)
    if (html_elements[item_name]) {

      // evaluate the value against the resolved scope
      // e.g. data.product.name
      renderHtmlElement(item_name, item_value, resolved_scope);
      continue;
    }

    // if item is a file-based html module (carousel, row, etc)
    if (html_modules[item_name]) {

      // render the html module with the resolved scope
      renderHtmlModule(item_name, item_value, resolved_scope);
      continue;
    }

    // otherwise, it is another yaml module
    // pass the resolved scope down to it
    parseModule(item_name, {
      data: resolved_scope,
    });
  }
}

function resolveData(expected, raw) {

  // expected describes how raw values should be resolved
  // e.g. { product: "content.products" }

  const scope = {};

  for (const key in expected) {

    const lookup_path = expected[key];
    const raw_value = raw[key];

    // if the expected value is a lookup path
    // resolve the raw value against that path
    // e.g. content.products[m8_plate_1]
    scope[key] = resolveLookup(lookup_path, raw_value);
  }

  return scope;
}

function resolveLookup(path, id) {

  // path is a dot-path like "content.products"
  // id is a scalar like "m8_plate_1"

  // walk the yaml object to the lookup root
  let node = yaml;
  for (const part of path.split(".")) {
    node = node?.[part];
  }

  // return the resolved object
  return node?.[id];
}


function renderHtmlElement(name, value, scope) {
  // evaluate value (e.g. data.product.name) against scope
  // output <name>resolved value</name>
}

function renderHtmlModule(name, value, scope) {
  // load html chunk from disk
  // render it using scope
}


/*
e.g. product_page
parseModule(module_name, data)
  - if module_name in html_modules
    - use it with data
  - else if module_name in yaml.modules
    - resolve our current data object
      - using the current data as lookups into the expected data of this module
    - for each item in this module
      - either from the `modules` object, or if the module itself is a list of items
      - parseModule() on each item 
  
*/


/*
get `product_page` module
the data {'product':'m8_plate_1'} gets passed to it

data.product is converted from the scalar 'm8_plate_1' to the mapping at yaml.content.products[m8_plate_1]

first item in the product_page modules is `header` which is another module,
but the `h1` is defined here, which is in the html element list,
so output it with the value from data.product.name



*/