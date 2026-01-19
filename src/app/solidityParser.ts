import parser from 'solidity-parser-antlr'
import type { ParseEdge, ParseFunction, ParseResult, SolidityVisibility } from './types'

const callBlocklist = new Set([
  'require',
  'assert',
  'revert',
  'emit',
  'if',
  'for',
  'while',
  'return',
  'new',
  'delete',
  'mapping',
  'address',
  'uint',
  'int',
  'bytes',
  'string',
  'bool',
  'keccak256',
  'sha256',
  'ripemd160',
  'ecrecover',
])

function normalizeVisibility(value: string | null | undefined): SolidityVisibility {
  if (value === 'public' || value === 'private' || value === 'internal' || value === 'external') return value
  return 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function functionDisplayName(fn: Record<string, unknown>): string {
  const kind = readString(fn.kind)
  if (readBoolean(fn.isConstructor) || kind === 'constructor') return 'constructor'
  if (kind === 'fallback') return 'fallback'
  if (kind === 'receive') return 'receive'
  return readString(fn.name) ?? 'unknown'
}

export function parseSoliditySource(code: string): ParseResult {
  const functions: ParseFunction[] = []
  const edges: ParseEdge[] = []
  const bodiesById = new Map<string, unknown>()
  const functionIdsByContract = new Map<string, Map<string, string[]>>()
  const baseContractsByContract = new Map<string, string[]>()
  const seen = new Map<string, number>()

  let ast: unknown
  try {
    ast = parser.parse(code, { tolerant: true, range: true, loc: false })
  } catch {
    return { functions, edges }
  }

  parser.visit(ast as Record<string, unknown>, {
    ContractDefinition: (node: unknown) => {
      if (!isRecord(node)) return
      const contractName = readString(node.name) ?? 'Contract'
      const subNodes = Array.isArray(node.subNodes) ? node.subNodes : []
      const baseContracts = Array.isArray(node.baseContracts) ? node.baseContracts : []
      const baseNames = baseContracts
        .map((base) => {
          if (!isRecord(base)) return null
          const baseNameNode = isRecord(base.baseName) ? base.baseName : null
          return readString(baseNameNode?.namePath) ?? readString(baseNameNode?.name) ?? readString(base.name) ?? null
        })
        .filter((value): value is string => Boolean(value))
      if (baseNames.length > 0) baseContractsByContract.set(contractName, baseNames)
      for (const sub of subNodes) {
        if (!isRecord(sub)) continue
        if (readString(sub.type) !== 'FunctionDefinition') continue
        const functionName = functionDisplayName(sub)
        const base = `${contractName}.${functionName}`
        const next = (seen.get(base) ?? 0) + 1
        seen.set(base, next)
        const id = next === 1 ? base : `${base}#${next}`
        const visibility = normalizeVisibility(readString(sub.visibility))
        functions.push({ id, contractName, functionName, visibility })
        bodiesById.set(id, sub.body ?? null)
        const byName = functionIdsByContract.get(contractName) ?? new Map<string, string[]>()
        const list = byName.get(functionName) ?? []
        list.push(id)
        byName.set(functionName, list)
        functionIdsByContract.set(contractName, byName)
      }
    },
  })

  const resolvedTargetsByContract = new Map<string, Map<string, string[]>>()
  const resolving = new Set<string>()
  const mergeTargets = (target: Map<string, string[]>, source: Map<string, string[]>) => {
    for (const [name, ids] of source) {
      const list = target.get(name) ?? []
      target.set(name, list.concat(ids))
    }
  }
  const getTargets = (contractName: string): Map<string, string[]> => {
    const cached = resolvedTargetsByContract.get(contractName)
    if (cached) return cached
    if (resolving.has(contractName)) return new Map()
    resolving.add(contractName)
    const combined = new Map<string, string[]>()
    mergeTargets(combined, functionIdsByContract.get(contractName) ?? new Map())
    const bases = baseContractsByContract.get(contractName) ?? []
    for (const base of bases) mergeTargets(combined, getTargets(base))
    resolving.delete(contractName)
    resolvedTargetsByContract.set(contractName, combined)
    return combined
  }

  const edgeIds = new Set<string>()
  for (const fn of functions) {
    const body = bodiesById.get(fn.id)
    if (!body) continue
    parser.visit(body as Record<string, unknown>, {
      FunctionCall: (node: unknown) => {
        if (!isRecord(node)) return
        const expression = isRecord(node.expression) ? node.expression : null
        if (!expression) return
        let targetMaps: Map<string, string[]>[] = []
        let calleeName: string | null = null
        const expressionType = readString(expression.type)
        if (expressionType === 'Identifier') {
          calleeName = readString(expression.name) ?? null
          targetMaps = [getTargets(fn.contractName)]
        } else if (expressionType === 'MemberAccess') {
          const memberName = readString(expression.memberName)
          if (!memberName) return
          const baseExpression = isRecord(expression.expression) ? expression.expression : null
          const baseType = baseExpression ? readString(baseExpression.type) : null
          const baseName = baseType === 'Identifier' ? readString(baseExpression?.name) : null
          if (!baseName) return
          calleeName = memberName
          if (baseName === 'this' || baseName === fn.contractName) {
            targetMaps = [getTargets(fn.contractName)]
          } else if (baseName === 'super') {
            const bases = baseContractsByContract.get(fn.contractName) ?? []
            targetMaps = bases.map((name) => getTargets(name))
          } else if (functionIdsByContract.has(baseName)) {
            targetMaps = [getTargets(baseName)]
          } else {
            return
          }
        }
        if (!calleeName || callBlocklist.has(calleeName)) return
        for (const targets of targetMaps) {
          const targetIds = targets.get(calleeName) ?? []
          for (const target of targetIds) {
            const edgeId = `${fn.id}->${target}`
            if (edgeIds.has(edgeId)) continue
            edgeIds.add(edgeId)
            edges.push({ source: fn.id, target })
          }
        }
      },
    })
  }

  return { functions, edges }
}
