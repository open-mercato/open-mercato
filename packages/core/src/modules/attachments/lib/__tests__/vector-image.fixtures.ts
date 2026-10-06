export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">'

function wrap(body: string): string {
  return `${SVG_OPEN}${body}</svg>`
}

export const BENIGN_LOGO = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 80" preserveAspectRatio="xMidYMid meet" width="200" height="80">
  <title>Brand mark</title>
  <defs>
    <style>.mark{fill:url(#brand-gradient);stroke:#1d3557;stroke-width:2}.word{font-family:Helvetica,Arial,sans-serif;font-size:24px;fill:#1d3557}</style>
    <linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e63946"/><stop offset="1" stop-color="#457b9d"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <clipPath id="badge-clip"><circle cx="40" cy="40" r="36"/></clipPath>
    <mask id="fade"><rect width="200" height="80" fill="url(#glow)"/></mask>
    <path id="leaf" d="M0 0 C10 -10 20 -10 30 0 C20 10 10 10 0 0 Z"/>
  </defs>
  <g clip-path="url(#badge-clip)">
    <rect class="mark" x="4" y="4" width="72" height="72"/>
    <use href="#leaf" x="25" y="40"/>
    <use xlink:href="#leaf" x="25" y="30" transform="rotate(20 40 40)"/>
  </g>
  <image x="150" y="10" width="40" height="40" href="data:image/png;base64,${TINY_PNG_BASE64}"/>
  <text class="word" x="90" y="48" mask="url(#fade)" style="letter-spacing:1px">Brand</text>
</svg>`

export const EDITOR_EXPORT_LOGO = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with a vector editor -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" viewBox="0 0 64 64" version="1.1" sodipodi:docname="mark.svg" inkscape:version="1.3">
  <sodipodi:namedview id="namedview1" pagecolor="#ffffff" inkscape:zoom="4"/>
  <metadata><rdf:RDF><dc:title>Mark</dc:title></rdf:RDF></metadata>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1">
    <path d="M8 8 H56 V56 H8 Z" style="fill:#2a9d8f;stroke:none" sodipodi:nodetypes="ccccc"/>
  </g>
</svg>`

export const MASKED_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <defs>
    <mask id="reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
      <rect width="120" height="120" fill="white"/>
      <circle cx="60" cy="60" r="24" fill="black"/>
    </mask>
  </defs>
  <g mask="url(#reveal)">
    <rect width="120" height="120" rx="16" fill="#264653"/>
  </g>
</svg>`

export const FILTERED_RASTER_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <filter id="texture" x="0" y="0" width="1" height="1">
      <feImage href="data:image/png;base64,${TINY_PNG_BASE64}" result="grain" preserveAspectRatio="none"/>
      <feComposite in="SourceGraphic" in2="grain" operator="in"/>
    </filter>
  </defs>
  <rect width="64" height="64" fill="#e76f51" filter="url(#texture)"/>
</svg>`

export const CDATA_STYLED_LOGO = `<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 100 40">
<style type="text/css"><![CDATA[
	.st0{fill:#E30613;}
	.st1{fill:#1D1D1B;}
	g > .st1{stroke:none;}
]]></style>
<rect class="st0" width="40" height="40"/>
<g><rect class="st1" x="50" width="50" height="40"/></g>
</svg>`

export type MaliciousFixture = {
  name: string
  svg: string
  payload: RegExp
  code: 'vector_image_unsafe_content' | 'vector_image_external_reference' | 'vector_image_entity_declaration'
}

export const MALICIOUS_FIXTURES: MaliciousFixture[] = [
  {
    name: 'script element',
    svg: wrap('<rect width="10" height="10"/><script>alert(document.domain)</script>'),
    payload: /script|alert/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'XHTML-namespaced script element',
    svg: wrap('<rect width="10" height="10"/><html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script>'),
    payload: /script|alert/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'script hidden inside a foreign-namespace wrapper',
    svg: wrap('<rect width="10" height="10"/><x:wrapper xmlns:x="urn:example:editor"><script>alert(1)</script></x:wrapper>'),
    payload: /script|alert|wrapper/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'script hidden inside metadata',
    svg: wrap('<metadata><script>alert(1)</script></metadata><rect width="10" height="10"/>'),
    payload: /script|alert/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'onload handler',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><rect width="10" height="10"/></svg>',
    payload: /onload|alert/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'onclick handler on a shape',
    svg: wrap('<rect width="10" height="10" onclick="alert(1)"/>'),
    payload: /onclick|alert/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'foreignObject with HTML',
    svg: wrap('<foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject>'),
    payload: /foreignObject|onerror|<div|<img/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'javascript: link',
    svg: wrap('<a href="javascript:alert(1)"><rect width="10" height="10"/></a>'),
    payload: /javascript:/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'obfuscated javascript: xlink',
    svg: wrap('<a xlink:href=" java&#x09;script:alert(1)"><rect width="10" height="10"/></a>'),
    payload: /script:|alert/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'external xlink:href on image',
    svg: wrap('<image width="10" height="10" xlink:href="https://tracker.example.com/pixel.png"/>'),
    payload: /tracker\.example\.com/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'non-raster data: image',
    svg: wrap('<image width="10" height="10" href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>'),
    payload: /data:image\/svg\+xml/,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'raster data: URI whose bytes are not that raster',
    svg: wrap('<image width="10" height="10" href="data:image/png;base64,PHN2Zz48L3N2Zz4="/>'),
    payload: /data:image\/png/,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'feImage with an external href',
    svg: wrap('<filter id="f"><feImage href="https://tracker.example.com/grain.png"/></filter><rect width="10" height="10" filter="url(#f)"/>'),
    payload: /tracker\.example\.com/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'feImage with a PNG data: URI whose bytes are not a PNG',
    svg: wrap('<filter id="f"><feImage href="data:image/png;base64,PHN2Zz48L3N2Zz4="/></filter><rect width="10" height="10" filter="url(#f)"/>'),
    payload: /data:image\/png/,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'feImage declaring JPEG while carrying PNG bytes',
    svg: wrap(`<filter id="f"><feImage href="data:image/jpeg;base64,${TINY_PNG_BASE64}"/></filter><rect width="10" height="10" filter="url(#f)"/>`),
    payload: /data:image\/jpeg/,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'comment opener hidden in a CSS string before an external url()',
    svg: wrap('<style>a{content:"/*"} rect{fill:url(https://evil.example/p.svg#p)} /*"*/</style><rect width="10" height="10"/>'),
    payload: /evil\.example/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'comment opener hidden in a CSS string before an external @font-face',
    svg: wrap('<style>x{content:"/*"} @font-face{font-family:f;src:url(https://evil.example/f.woff)} text{font-family:f} /*"*/</style><text>Brand</text>'),
    payload: /evil\.example/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'comment opener hidden in a style attribute string',
    svg: wrap(`<rect width="10" height="10" style='font-family:"/*"; fill:url(https://evil.example/p.svg#p); /*"*/'/>`),
    payload: /evil\.example/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'comment opener hidden in a single-quoted CSS string',
    svg: wrap(`<style>a{content:'/*'} rect{fill:url(https://evil.example/p.svg#p)} /*'*/</style><rect width="10" height="10"/>`),
    payload: /evil\.example/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'CSS string left unterminated at a newline',
    svg: wrap('<style>a{content:"/*\n} rect{fill:url(https://evil.example/p.svg#p)} /*"*/</style><rect width="10" height="10"/>'),
    payload: /evil\.example/,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'CSS string left unterminated at the end of the stylesheet',
    svg: wrap('<style>rect{fill:#000} a{content:"url(https://evil.example/p.svg#p)</style><rect width="10" height="10"/>'),
    payload: /evil\.example/,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'escaped quote keeping a CSS string open',
    svg: wrap('<style>a{content:"\\"/*"} rect{fill:url(https://evil.example/p.svg#p)} /*"*/</style><rect width="10" height="10"/>'),
    payload: /evil\.example/,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'comment inside an unquoted url()',
    svg: wrap('<style>rect{fill:url(/*x*/https://evil.example/p.svg#p)}</style><rect width="10" height="10"/>'),
    payload: /evil\.example/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'external url() hidden after a quoted url() containing a comment opener',
    svg: wrap('<style>rect{fill:url("#a/*")} circle{fill:url(https://evil.example/p.svg#p)} /*")*/</style><rect id="a" width="10" height="10"/><circle r="2"/>'),
    payload: /evil\.example/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'DOCTYPE whose public id contains > ahead of an internal subset',
    svg: '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//x>y//EN" "z" [ <!ATTLIST svg onload CDATA #FIXED "alert(1)"> ]><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    payload: /ATTLIST|alert/,
    code: 'vector_image_entity_declaration',
  },
  {
    name: 'DOCTYPE whose single-quoted system id contains > ahead of an internal subset',
    svg: `<?xml version="1.0"?><!DOCTYPE svg SYSTEM 'a>b' [ <!ATTLIST svg onload CDATA #FIXED "alert(1)"> ]><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`,
    payload: /ATTLIST|alert/,
    code: 'vector_image_entity_declaration',
  },
  {
    name: 'external url() in a style element',
    svg: wrap('<style>rect{fill:url(https://tracker.example.com/paint.svg#p)}</style><rect width="10" height="10"/>'),
    payload: /tracker\.example\.com/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'external url() in a style attribute',
    svg: wrap('<rect width="10" height="10" style="fill:url(\'https://tracker.example.com/paint.svg#p\')"/>'),
    payload: /tracker\.example\.com/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'external url() in a presentation attribute',
    svg: wrap('<rect width="10" height="10" fill="url(https://tracker.example.com/paint.svg#p)"/>'),
    payload: /tracker\.example\.com/,
    code: 'vector_image_external_reference',
  },
  {
    name: '@import in a style element',
    svg: wrap('<style>@import url("https://fonts.example.com/brand.css"); text{font-family:Brand}</style><text>Brand</text>'),
    payload: /@import|fonts\.example\.com/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'CSS escape smuggling url()',
    svg: wrap('<style>rect{fill:\\75 rl(https://tracker.example.com/p.svg#p)}</style><rect width="10" height="10"/>'),
    payload: /tracker\.example\.com/,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'image-set() with a bare string URL',
    svg: wrap('<rect width="10" height="10" style="mask-image:image-set(\'https://tracker.example.com/m.png\' 1x)"/>'),
    payload: /tracker\.example\.com/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'DOCTYPE with entity expansion (billion laughs)',
    svg: `<?xml version="1.0"?>
<!DOCTYPE svg [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<svg xmlns="http://www.w3.org/2000/svg"><text>&lol3;</text></svg>`,
    payload: /lol/,
    code: 'vector_image_entity_declaration',
  },
  {
    name: 'external entity',
    svg: `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>`,
    payload: /passwd/,
    code: 'vector_image_entity_declaration',
  },
  {
    name: 'use referencing an external document',
    svg: wrap('<use href="https://assets.example.com/sprite.svg#icon"/>'),
    payload: /assets\.example\.com/,
    code: 'vector_image_external_reference',
  },
  {
    name: 'set animating href',
    svg: wrap('<a href="#safe"><set attributeName="href" to="javascript:alert(1)"/><rect id="safe" width="10" height="10"/></a>'),
    payload: /<set|javascript:/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'animate targeting xlink:href',
    svg: wrap('<a xlink:href="#safe"><animate attributeName="xlink:href" values="javascript:alert(1)"/><rect id="safe" width="10" height="10"/></a>'),
    payload: /<animate|javascript:/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'iframe element',
    svg: wrap('<iframe xmlns="http://www.w3.org/1999/xhtml" src="https://example.com"></iframe>'),
    payload: /iframe|example\.com/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'embed element',
    svg: wrap('<embed xmlns="http://www.w3.org/1999/xhtml" src="https://example.com/x.swf"/>'),
    payload: /embed|example\.com/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'object element',
    svg: wrap('<object xmlns="http://www.w3.org/1999/xhtml" data="https://example.com/x.html"></object>'),
    payload: /object|example\.com/i,
    code: 'vector_image_unsafe_content',
  },
  {
    name: 'xml-stylesheet processing instruction',
    svg: `<?xml version="1.0"?><?xml-stylesheet href="https://example.com/brand.css" type="text/css"?>${wrap('<rect width="10" height="10"/>')}`,
    payload: /xml-stylesheet|example\.com/,
    code: 'vector_image_external_reference',
  },
]

export function nestedUseBomb(levels: number, fanOut: number): string {
  const groups: string[] = ['<g id="g0"><rect width="1" height="1"/></g>']
  for (let level = 1; level <= levels; level += 1) {
    const uses = Array.from({ length: fanOut }, () => `<use href="#g${level - 1}"/>`).join('')
    groups.push(`<g id="g${level}">${uses}</g>`)
  }
  return wrap(`<defs>${groups.join('')}</defs><use href="#g${levels}"/>`)
}
