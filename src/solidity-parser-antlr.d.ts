declare module 'solidity-parser-antlr' {
  type ParseOptions = {
    tolerant?: boolean
    loc?: boolean
    range?: boolean
  }

  type VisitorMap = Record<string, (node: unknown) => void>

  const parser: {
    parse: (input: string, options?: ParseOptions) => unknown
    visit: (ast: Record<string, unknown>, visitor: VisitorMap) => void
    ParserError: new (...args: unknown[]) => Error
  }

  export default parser
}
