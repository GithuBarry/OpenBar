-- OpenBarry Pandoc Lua filter: metadata, source annotations, conversion-loss.

local losses = {}

local function note(kind)
  table.insert(losses, pandoc.MetaString(kind))
end

function RawBlock(el)
  if el.format == "latex" or el.format == "tex" then
    note("raw-tex-block")
    return pandoc.Div({ pandoc.CodeBlock(el.text, { class = "language-tex" }) }, { class = "ob-tex-unknown" })
  end
end

function RawInline(el)
  if el.format == "latex" or el.format == "tex" then
    note("raw-tex-inline")
    return pandoc.Span({ pandoc.Code(el.text) }, { class = "ob-tex-unknown" })
  end
end

function Math(el)
  -- MathML is produced by --mathml; keep math nodes as-is.
  return el
end

function Pandoc(doc)
  doc.meta["openbarry-loss"] = pandoc.MetaList(losses)
  return doc
end
