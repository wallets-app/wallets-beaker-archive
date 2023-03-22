/* globals customElements */
import * as rpc from 'pauls-electron-rpc'
import { LitElement, html, css } from './vendor/lit-element/lit-element'
import { repeat } from './vendor/lit-element/lit-html/directives/repeat'
import { classMap } from './vendor/lit-element/lit-html/directives/class-map'
import { unsafeHTML } from './vendor/lit-element/lit-html/directives/unsafe-html'
import { examineLocationInput } from './lib/urls'
import browserManifest from '@beaker/core/web-apis/manifests/internal/browser'
import bookmarksManifest from '@beaker/core/web-apis/manifests/internal/bookmarks'
import historyManifest from '@beaker/core/web-apis/manifests/internal/history'
import locationBarManifest from './background-process/rpc-manifests/location-bar'
import viewsManifest from './background-process/rpc-manifests/views'

const bg = {
  beakerBrowser: rpc.importAPI('beaker-browser', browserManifest),
  bookmarks: rpc.importAPI('bookmarks', bookmarksManifest),
  history: rpc.importAPI('history', historyManifest),
  locationBar: rpc.importAPI('background-process-location-bar', locationBarManifest),
  views: rpc.importAPI('background-process-views', viewsManifest)
}

class LocationBar extends LitElement {
  static get properties () {
    return {
      inputValue: {type: String},
      autocompleteResults: {type: Array},
      currentSelection: {type: Number}
    }
  }

  constructor () {
    super()
    this.reset()

    // fetch platform information
    var {platform} = bg.beakerBrowser.getInfo()
    window.platform = platform
    if (platform === 'darwin') {
      document.body.classList.add('darwin')
    }
    if (platform === 'win32') {
      document.body.classList.add('win32')
    }

    // export interface
    window.setup = () => this.reset()
    window.command = (command, opts) => this.onCommand(command, opts)
  }

  reset () {
    this.inputValue = ''
    this.autocompleteResults = []
    this.currentSelection = 0
  }

  render () {
    return html`
      <link rel="stylesheet" href="beaker://assets/font-awesome.css">
      <div class="wrapper">
        <div class="autocomplete-results">
          ${repeat(this.autocompleteResults, (r, i) => this.renderAutocompleteResult(r, i))}
        </div>
      </div>
    `
  }

  renderAutocompleteResult (r, i) {
    // content
    var contentColumn
    if (r.search) {
      contentColumn = html`<span class="result-search">${r.search}</span>`
    } else {
      contentColumn = html`<span class="result-url">${r.urlDecorated ? unsafeHTML(r.urlDecorated) : r.url}</span>`
    }
    var titleColumn = html`<span class="result-title">${r.titleDecorated ? unsafeHTML(r.titleDecorated) : r.title}</span>`

    // selection
    var rowCls = classMap({
      result: true,
      selected: i === this.currentSelection
    })

    // result row
    return html`
      <div class=${rowCls} data-result-index=${i} @click=${this.onClickResult}>
        ${r.bookmarked ? html`<i class="far fa-star"></i>` : ''}
        ${r.search
          ? html`<i class="icon fa fa-search"></i>`
          : html`<img class="icon" src=${'beaker-favicon:' + r.url}/>`
        }
        ${contentColumn}
        ${titleColumn}
      </div>
    `
  }

  // events
  // =

  onCommand (cmd, opts) {
    switch (cmd) {
      case 'set-value':
        if (opts.value && opts.value !== this.inputValue) {
          this.inputValue = opts.value
          this.currentSelection = 0
          this.queryAutocomplete()
        }
        break
      case 'choose-selection':
        {
          let selection = this.autocompleteResults[this.currentSelection]
          bg.locationBar.loadURL(selection.url)
          bg.locationBar.close()
        }
        break
      case 'move-selection':
        {
          if (opts.up && this.currentSelection > 0) { this.currentSelection = this.currentSelection - 1 }
          if (opts.down && this.currentSelection < this.autocompleteResults.length - 1) { this.currentSelection = this.currentSelection + 1 }
          let res = this.autocompleteResults[this.currentSelection]
          this.inputValue = res.url
          return res.search || res.url
        }
    }
  }

  onContextMenu (e) {
    bg.views.showLocationBarContextMenu('active')
  }

  onClickResult (e) {
    let selection = this.autocompleteResults[e.currentTarget.dataset.resultIndex]
    bg.locationBar.loadURL(selection.url)
    bg.locationBar.close()
  }

  resize () {
    // DISABLED
    // this was causing major performance costs
    // maybe we should use transparent windows instead?
    // -prf

    // adjust height based on rendering
    // var height = this.shadowRoot.querySelector('div').clientHeight
    // bg.locationBar.resizeSelf({height})
  }

  async queryAutocomplete () {
    var finalResults
    var searchResults = await bg.history.search(this.inputValue)

    // decorate result with bolded regions
    // explicitly replace special characters to match sqlite fts tokenization
    var searchTerms = this.inputValue.replace(/[:^*-./]/g, ' ').split(' ').filter(Boolean)
    searchResults.forEach(r => decorateResultMatches(searchTerms, r))

    // figure out what we're looking at
    var {vWithProtocol, vSearch, isProbablyUrl, isGuessingTheScheme} = examineLocationInput(this.inputValue)

    // set the top results accordingly
    var gotoResult = { url: vWithProtocol, title: 'Go to ' + this.inputValue, isGuessingTheScheme }
    var searchResult = {
      search: this.inputValue,
      title: 'DuckDuckGo Search',
      url: vSearch
    }
    if (isProbablyUrl) finalResults = [gotoResult, searchResult]
    else finalResults = [searchResult, gotoResult]

    // add search results
    if (searchResults) {
      finalResults = finalResults.concat(searchResults)
    }

    // apply limit
    finalResults = finalResults.slice(0, 11)

    // read bookmark state
    await Promise.all(finalResults.map(async r => {
      let bookmarked = false
      try {
        bookmarked = await bg.bookmarks.isBookmarked(r.url)
      } catch (_) {}
      Object.assign(r, {bookmarked})
    }))

    // render
    this.autocompleteResults = finalResults

    await this.updateComplete
    this.resize()
  }
}
LocationBar.styles = [css`
.wrapper {
  background: red;
  padding-bottom: 4px; /* add a little breathing room to the bottom */
}

.result {
  position: relative;
  padding: 0 10px 0 14px;
  display: flex;
  align-items: center;
  height: 28px;
  font-size: 14px;
  cursor: default;
}

.result .fa-star-o {
  position: absolute;
  left: 90px;
  color: #707070;
  font-size: 16px;
}

.result .icon {
  margin-right: 10px;
  width: 15px;
  display: inline-block;
  text-align: center;
}

.result .fa-search {
  font-size: 13px;
  color: #707070;
}

.result .result-url,
.result .result-title,
.result .result-search{
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result .result-url {
  color: #1f55c1;
  display: inline-block;
  max-width: 35%;
  vertical-align: top;
}

.result .result-title {
  margin-left: 2px;
  color: #707070;
}

.result .result-title:before {
  content: '-';
  margin-right: 5px;
}

.result.selected {
  background: #dbebff;
}

.result.selected .result-title {
  color: #333;
}

.result:hover {
  background: #eee;
}

`]

customElements.define('location-bar', LocationBar)

// internal methods
// =

// helper for autocomplete
// - takes in the current search (tokenized) and a result object
// - mutates `result` so that matching text is bold
var offsetsRegex = /([\d]+ [\d]+ [\d]+ [\d]+)/g
function decorateResultMatches (searchTerms, result) {
  // extract offsets
  var tuples = (result.offsets || '').match(offsetsRegex)
  if (!tuples) { return }

  // iterate all match tuples, and break the values into segments
  let lastTuple
  let segments = { url: [], title: [] }
  let lastOffset = { url: 0, title: 0 }
  for (let tuple of tuples) {
    tuple = tuple.split(' ').map(i => +i) // the map() coerces to the proper type
    let [ columnIndex, termIndex, offset ] = tuple
    let columnName = ['url', 'title'][columnIndex]

    // sometimes multiple terms can hit at the same point
    // that breaks the algorithm, so skip that condition
    if (lastTuple && lastTuple[0] === columnIndex && lastTuple[2] === offset) continue
    lastTuple = tuple

    // use the length of the search term
    // (sqlite FTS gives the length of the full matching token, which isnt as helpful)
    let searchTerm = searchTerms[termIndex]
    if (!searchTerm) continue
    let len = searchTerm.length

    // extract segments
    segments[columnName].push(result[columnName].slice(lastOffset[columnName], offset))
    segments[columnName].push(result[columnName].slice(offset, offset + len))
    lastOffset[columnName] = offset + len
  }

  // add the remaining text
  segments.url.push(result.url.slice(lastOffset.url))
  segments.title.push(result.title.slice(lastOffset.title))

  // join the segments with <strong> tags
  result.urlDecorated = joinSegments(segments.url)
  result.titleDecorated = joinSegments(segments.title)
}

// helper for decorateResultMatches()
// - takes an array of string segments (extracted from the result columns)
// - outputs a single escaped string with every other element wrapped in <strong>
var ltRegex = /</g
var gtRegex = />/g
function joinSegments (segments) {
  var str = ''
  var isBold = false
  for (var segment of segments) {
    // escape for safety
    segment = segment.replace(ltRegex, '&lt;').replace(gtRegex, '&gt;')

    // decorate with the strong tag
    if (isBold) str += '<strong>' + segment + '</strong>'
    else str += segment
    isBold = !isBold
  }
  return str
}
