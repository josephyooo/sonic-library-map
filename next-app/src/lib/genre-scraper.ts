/**
 * Scrape genre coordinates from Every Noise at Once.
 *
 * Each genre on everynoise.com is a positioned <div> with:
 *   style="top: Ypx; left: Xpx; ..."
 *   onclick="playx(..., 'genre name', ...)"
 *
 * We normalize coordinates to [0, 1] range for both axes.
 * Canvas dimensions: 1610px wide × ~22000px tall.
 */

import * as cheerio from "cheerio";

export interface GenreCoord {
  name: string;
  x: number; // 0–1 (left → right)
  y: number; // 0–1 (top → bottom)
}

const EVERYNOISE_URL = "https://everynoise.com";
const CANVAS_WIDTH = 1610;

function decodeHtmlEntities(value: string): string {
  return cheerio.load(value).root().text();
}

export async function scrapeGenreCoordinates(): Promise<GenreCoord[]> {
  const response = await fetch(EVERYNOISE_URL, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Every Noise: ${response.status}`);
  }

  const html = await response.text();
  return parseGenreCoordinates(html);
}

export function parseGenreCoordinates(html: string): GenreCoord[] {
  const $ = cheerio.load(html);

  // Get canvas height from inline style
  const canvasStyle = $("div.canvas").attr("style") || "";
  const heightMatch = canvasStyle.match(/height:\s*(\d+)px/);
  const canvasHeight = heightMatch ? parseInt(heightMatch[1], 10) : 22000;

  const genres: GenreCoord[] = [];

  $("div.genre").each((_, el) => {
    const style = $(el).attr("style") || "";
    const onclick = $(el).attr("onclick") || "";

    // Extract top and left from inline style
    const topMatch = style.match(/top:\s*(\d+)px/);
    const leftMatch = style.match(/left:\s*(\d+)px/);
    if (!topMatch || !leftMatch) return;

    // Extract genre name from onclick: playx("...", "genre name", this)
    const decodedOnclick = decodeHtmlEntities(onclick);
    const doubleQuotedName = decodedOnclick.match(
      /playx\([^,]+,\s*"([^"]+)"/,
    )?.[1];
    const singleQuotedName = decodedOnclick.match(
      /playx\([^,]+,\s*'([^']+)'/,
    )?.[1];
    const name = doubleQuotedName ?? singleQuotedName;
    if (!name) return;

    const top = parseInt(topMatch[1], 10);
    const left = parseInt(leftMatch[1], 10);

    genres.push({
      name: name.toLowerCase(),
      x: left / CANVAS_WIDTH,
      y: top / canvasHeight,
    });
  });

  return genres;
}
