import qrcode from "qrcode-generator";

const SVG = "http://www.w3.org/2000/svg";
// The quiet zone the QR specification asks for around the modules.
const MARGIN = 4;

// Builds the code as DOM nodes: the page's CSP forbids inline styles and markup injection.
// Throws when the text exceeds the capacity of the largest QR version.
export function qrSvg(text: string): SVGSVGElement {
  const code = qrcode(0, "L");
  code.addData(text, "Byte");
  code.make();
  const count = code.getModuleCount();
  const size = count + MARGIN * 2;
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (code.isDark(row, column)) path += `M${column + MARGIN} ${row + MARGIN}h1v1h-1z`;
    }
  }
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  const background = document.createElementNS(SVG, "rect");
  background.setAttribute("width", String(size));
  background.setAttribute("height", String(size));
  background.setAttribute("fill", "#fff");
  const modules = document.createElementNS(SVG, "path");
  modules.setAttribute("d", path);
  modules.setAttribute("fill", "#000");
  svg.append(background, modules);
  return svg;
}
