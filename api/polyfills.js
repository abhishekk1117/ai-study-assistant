// Setup canvas polyfills BEFORE any other requires
if (typeof global !== 'undefined') {
  if (typeof DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix {
      constructor(init) {
        this.a = init?.[0] || 1;
        this.b = init?.[1] || 0;
        this.c = init?.[2] || 0;
        this.d = init?.[3] || 1;
        this.e = init?.[4] || 0;
        this.f = init?.[5] || 0;
      }
    };
  }
  if (typeof ImageData === 'undefined') {
    global.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  }
  if (typeof Path2D === 'undefined') {
    global.Path2D = class Path2D {
      constructor() {
        this.commands = [];
      }
      moveTo(x, y) {
        this.commands.push(['moveTo', x, y]);
      }
      lineTo(x, y) {
        this.commands.push(['lineTo', x, y]);
      }
      closePath() {
        this.commands.push(['closePath']);
      }
    };
  }
}

module.exports = {};
