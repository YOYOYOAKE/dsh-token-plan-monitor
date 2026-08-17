// Wrap the tsc-compiled client module into the browser module-loader factory
// bundle shape (`window.__ModuleLoader__.load({ id, factory })`), mirroring
// the tsdown output of shipped client packages (see deepseek-harness-quota-monitor).
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const compiled = readFileSync('lib-client/client.js', 'utf8')
const bundle = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(pkg.name)},
	factory: (require) => {
		'use strict'
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
${compiled}
		return module.exports
	}
})
`
writeFileSync('lib/client.js', bundle)
console.log('lib/client.js wrapped into the module-loader factory bundle')
