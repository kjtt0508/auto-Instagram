// [任意アダプタ] eslint.config.mjs に取り込む: import domainRules from "./eslint.domain.mjs"; export default [...既存, ...domainRules];
// files のパスは domain ディレクトリの位置に合わせる
export default [
  {
    files: ["**/domain/**/*.{ts,tsx,js,jsx}"],
    rules: {
      // P16 ドメインは UI・通信に依存しない
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["react", "react-*", "next", "next/*"], message: "P16: domain は UI フレームワークに依存しない" },
          { group: ["@/app/*", "@/components/*", "@/features/*", "@/lib/api/*"], message: "P16: 依存の向きは UI → domain" },
        ],
      }],
      "no-restricted-globals": ["error", { name: "fetch", message: "P16: 通信は src/lib/api へ" }],
      // P13 null を返さない（undefined も含め「未設定」は型で表す）
      "no-restricted-syntax": ["error",
        { selector: "ReturnStatement > Literal[value=null]", message: "P13: null を返さない。Result 型を使う" },
        { selector: "MethodDefinition[kind='set']", message: "P12: setter 禁止" },
      ],
    },
  },
];
