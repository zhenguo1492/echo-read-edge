# EchoRead Edge

A standalone Chrome extension that reads a document aloud sentence by sentence,
highlights what it is speaking, and looks up words the reader asks about. This
glossary fixes the language used for how text is located and addressed on a
page, independent of how that page happens to be rendered.

## Locating text

**Text Source**:
The origin of readable text for one document, able to answer three questions:
what the text is, which offset a screen point falls on, and where an offset
range appears on screen. The page DOM is one Text Source; a parsed PDF is
another.
_Avoid_: Provider, extractor, parser, backend

**Text Coordinate Space**:
A single flat sequence of UTF-16 offsets covering one document's readable text,
with block transitions represented as newlines. Offsets are continuous across
the whole document and do not restart.
_Avoid_: Character index, position map, text buffer

**Segment**:
A region of a document whose on-screen geometry can become unavailable and
later return, such as a PDF page that is unloaded while scrolled away. A
Segment bounds geometry only; it never bounds the Text Coordinate Space, so a
Sentence may span Segments.
_Avoid_: Page, chunk, partition, block

**Sentence**:
A bounded unit of synthesis, identified by its offset range in the Text
Coordinate Space. Its identity is that range and survives the document being
re-rendered.
_Avoid_: Utterance, phrase, line

**Geometry**:
The screen rectangles an offset range currently occupies. Geometry is derived
from the Text Source, is valid only for the present rendering, and is expected
to become stale and be resolved again.
_Avoid_: Position, bounds, layout, rects (as a domain term)
