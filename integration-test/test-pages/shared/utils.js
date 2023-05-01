/**
 * @typedef {object} ResultRow
 * @property {string} name The name of the test.
 * @property {any} result The result of the test.
 * @property {any} expected The expected result.
 */

function buildTableCell (value, tagName = 'td') {
    const td = document.createElement(tagName)
    td.textContent = value
    return td
}

/**
 * Builds a result table for the given results.
 * @param {Record<string, ResultRow>} results The results to build the table for.
 * @return {Element} The table element.
 */
// eslint-disable-next-line no-unused-vars
function buildResultTable (results) {
    const table = document.createElement('table')
    table.className = 'results'
    const thead = document.createElement('thead')
    let tr = document.createElement('tr')
    tr.appendChild(buildTableCell('Test', 'th'))
    tr.appendChild(buildTableCell('Result', 'th'))
    tr.appendChild(buildTableCell('Expected', 'th'))
    thead.appendChild(tr)
    table.appendChild(thead)
    for (const name in results) {
        const resultSection = results[name]
        const tbody = document.createElement('tbody')
        tr = document.createElement('tr')
        const heading = buildTableCell(name, 'th')
        // @ts-expect-error - colSpan is not defined in the type definition
        heading.colSpan = 3
        tr.appendChild(heading)
        tbody.appendChild(tr)

        // @ts-expect-error - resultSection.forEach is not defined in the type definition
        resultSection.forEach((result) => {
            const resultOut = JSON.stringify(result.result)
            const expectedOut = JSON.stringify(result.expected)
            tr = document.createElement('tr')
            tr.appendChild(buildTableCell(result.name))
            tr.appendChild(buildTableCell(resultOut))
            tr.appendChild(buildTableCell(expectedOut))
            tr.classList.add(resultOut === expectedOut ? 'pass' : 'fail')
            tbody.appendChild(tr)
        })
        table.appendChild(tbody)
    }
    return table
}

let isInAutomation = false
let isReadyPromiseResolve = null
const isReadyPromise = new Promise((resolve) => {
    isReadyPromiseResolve = resolve
})
const url = new URL(window.location.href)
if (url.searchParams.get('automation')) {
    isInAutomation = true
    window.addEventListener('content-scope-init-complete', (e) => {
        isReadyPromiseResolve()
    })
}

// @ts-expect-error - ongoingTests is not defined in the type definition
window.ongoingTests = []
// eslint-disable-next-line no-unused-vars
function test (name, test) {
    // @ts-expect-error - ongoingTests is not defined in the type definition
    window.ongoingTests.push({ name, test })
}

let currentResults = null
// eslint-disable-next-line no-unused-vars
async function renderResults () {
    const results = {}
    if (isInAutomation) {
        await isReadyPromise
    }
    // @ts-expect-error - ongoingTests is not defined in the type definition
    for (const test of window.ongoingTests) {
        currentResults = []
        let result = await test.test()
        if (currentResults.length) {
            result = currentResults
        }
        results[test.name] = result
    }
    // @ts-expect-error - buildResultTable is not defined in the type definition
    document.body.appendChild(buildResultTable(results))
    window.dispatchEvent(new CustomEvent('results-ready', { detail: results }))
    // @ts-expect-error - results is not defined in the type definition
    window.results = results
}

/*
async function init () {
    results.date = (new Date()).toUTCString()
    for (const test of tests) {
        insertResultRow('category', [test.category, test.id])
        let value = null
        try {
            value = await Promise.resolve(test.value())
        } catch (e) {
            fail('Test code threw', e)
        }
        results.results.push({
            id: test.id,
            value,
            category: test.category
        })
        await new Promise((resolve) => {
            setTimeout(resolve, 100)
        })
    }
    results.complete = true
}
*/

/* test utils */
function insertResultRow (type, args) {
    const row = {
        type,
        args
    }
    if (currentResults) {
        currentResults.push(row)
    }
}

function fail (...args) {
    insertResultRow('fail', args)
}

function pass (...args) {
    insertResultRow('pass', args)
}

function eq (val1, val2, ...args) {
    ok(val1 === val2, `Expect value '${val1}' to equal '${val2}'`)
}

function ok (val, ...args) {
    if (!val) {
        fail(...args)
    } else {
        pass(...args)
    }
}
