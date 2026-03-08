local function stringify(meta_value)
  return pandoc.utils.stringify(meta_value or '')
end

local function has_class(el, class_name)
  if not el.classes then
    return false
  end
  for _, class in ipairs(el.classes) do
    if class == class_name then
      return true
    end
  end
  return false
end

local function header_identifier(el)
  if el.identifier and el.identifier ~= '' then
    return el.identifier
  end
  if el.attr then
    if el.attr.identifier then
      return el.attr.identifier
    end
    if el.attr[1] and el.attr[1] ~= '' then
      return el.attr[1]
    end
  end
  return nil
end

local function publication_blocks(doc)
  local rights = stringify(doc.meta.rights)
  local revision = stringify(doc.meta['source-revision-short'])
  local published_at = stringify(doc.meta['published-at-utc'])

  if rights == '' and revision == '' then
    return nil
  end

  local blocks = pandoc.List:new({
    pandoc.Header(2, 'Copyright and disclaimer'),
    pandoc.Para({ pandoc.Strong({ pandoc.Str('The Dionysus Program') }) }),
    pandoc.Para({ pandoc.Strong({ pandoc.Str('Rites of Renewal') }) }),
  })

  if rights ~= '' then
    blocks:insert(pandoc.Para({ pandoc.Str(rights) }))
  end

  blocks:insert(pandoc.Para({
    pandoc.Str('The Dionysus Program: Rites of Renewal is licensed under a Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License.')
  }))

  blocks:insert(pandoc.Para({
    pandoc.Strong({ pandoc.Str('You are free to:') }),
    pandoc.LineBreak(),
    pandoc.Str('Share — copy and redistribute the material in any medium or format.')
  }))

  blocks:insert(pandoc.Para({
    pandoc.Strong({ pandoc.Str('Under the following terms:') }),
    pandoc.LineBreak(),
    pandoc.Str('Attribution — You must give appropriate credit to the author, Sean Devine, and provide a link to the license.'),
    pandoc.LineBreak(),
    pandoc.Str('NonCommercial — You may not use the material for commercial purposes.'),
    pandoc.LineBreak(),
    pandoc.Str('NoDerivatives — If you remix, transform, or build upon the material, you may not distribute the modified material.')
  }))

  blocks:insert(pandoc.Para({
    pandoc.Str('To view a copy of this license, visit '),
    pandoc.Link('https://creativecommons.org/licenses/by-nc-nd/4.0/', 'https://creativecommons.org/licenses/by-nc-nd/4.0/')
  }))

  blocks:insert(pandoc.Para({
    pandoc.Strong({ pandoc.Str('First edition: December 2025') }),
    pandoc.LineBreak(),
    pandoc.Strong({ pandoc.Str('First print edition: February 24, 2026') })
  }))

  if published_at ~= '' then
    local revision_inlines = pandoc.List:new({
      pandoc.Strong({ pandoc.Str('Revision:') }),
      pandoc.Space(),
    })

    if revision ~= '' then
      revision_inlines:insert(pandoc.Code(revision))
    end

    revision_inlines:insert(pandoc.Space())
    revision_inlines:insert(pandoc.Str('—'))
    revision_inlines:insert(pandoc.Space())
    revision_inlines:insert(pandoc.Str(published_at))
    blocks:insert(pandoc.Para(revision_inlines))
  elseif revision ~= '' then
    blocks:insert(pandoc.Para({
      pandoc.Strong({ pandoc.Str('Revision:') }),
      pandoc.Space(),
      pandoc.Code(revision)
    }))
  end

  blocks:insert(pandoc.Para({
    pandoc.Strong({ pandoc.Str('Disclaimer') }),
    pandoc.LineBreak(),
    pandoc.Str('This book is designed to provide information and motivation to our readers. It is provided with the understanding that the publisher is not engaged in rendering legal, accounting, or other professional services. If legal or other expert assistance is required, the services of a competent professional should be sought.')
  }))

  blocks:insert(pandoc.Para({
    pandoc.Strong({ pandoc.Str('Notice Regarding Appendix C') }),
    pandoc.LineBreak(),
    pandoc.Str('The "Letters to the Editor" contained in Appendix C are works of satire and dramatization. They are literary devices composed by the author to illustrate philosophical concepts. They are not actual correspondence from, nor are they endorsed by, the individuals named. Any resemblance to actual private communications is purely coincidental.')
  }))

  blocks:insert(pandoc.Para({
    pandoc.Strong({ pandoc.Str('ISBN:') }),
    pandoc.Space(),
    pandoc.Str('9798249715557'),
    pandoc.LineBreak(),
    pandoc.Strong({ pandoc.Str('Imprint:') }),
    pandoc.Space(),
    pandoc.Str('Independently published')
  }))

  blocks:insert(pandoc.Para({
    pandoc.Str('Published by Sean Devine'),
    pandoc.LineBreak(),
    pandoc.Str('www.dionysusprogram.com')
  }))

  return pandoc.Div(blocks, pandoc.Attr('', { 'publication-details' }))
end

function Pandoc(doc)
  if not FORMAT:match('epub') then
    return doc
  end

  local details = publication_blocks(doc)
  if not details then
    return doc
  end

  local blocks = pandoc.List:new()
  local inserted = false

  for _, block in ipairs(doc.blocks) do
    blocks:insert(block)

    if not inserted and block.t == 'Div' and has_class(block, 'dedication') then
      blocks:insert(details)
      inserted = true
    end
  end

  if not inserted then
    blocks:insert(1, details)
  end

  doc.blocks = blocks
  return doc
end
