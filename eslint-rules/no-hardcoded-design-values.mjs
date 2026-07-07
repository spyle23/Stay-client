/**
 * Règle ESLint maison — « aucune valeur en dur » (UX-DR-1.11).
 *
 * Interdit, dans le code applicatif, de coder en dur une COULEUR ou un ESPACEMENT
 * au lieu de référencer un token du design-system :
 *   - classes Tailwind à valeur arbitraire de couleur  : `bg-[#0e7c86]`, `text-[rgb(...)]`,
 *     couleur incrustée `shadow-[0_2px_8px_#000]`, directionnelle `border-t-[#000]`,
 *     hint de type `text-[color:#fff]`
 *   - classes Tailwind à valeur arbitraire d'espacement/dimension :
 *     `p-[13px]`, `gap-[10px]`, `w-[200px]`, `min-h-[100vh]`, `w-[50%]`
 *   - couleurs littérales dans un `style` inline : `style={{ color: "#fff" }}`
 *
 * SCOPE (anti faux-positifs) : seules les chaînes de CLASSES sont inspectées —
 * attribut `className` et arguments des helpers de classes (`cn/cva/clsx/tv/twMerge/
 * twJoin/classNames`). Une chaîne quelconque (message d'erreur, doc) n'est jamais
 * signalée.
 *
 * AUTORISÉ (tokenisé) : `bg-primary`, `p-4`, `rounded-(--cell-radius)`, `w-[var(--x)]`,
 * `size-(--tap-min)`, et l'injection de variables CSS `style={{ "--hotel-primary": "#7c3aed" }}`
 * (clé commençant par `--`, seule voie légitime pour le branding hôtel).
 *
 * LIMITES CONNUES (voir deferred-work.md) : les couleurs de palette Tailwind nommées
 * (`bg-red-500`, `text-zinc-600`) ne sont pas détectées (nécessiterait un allowlist des
 * tokens sémantiques). Les valeurs de classe/style construites dynamiquement (variable,
 * template avec expression, objet de style extrait) ne sont pas résolues statiquement.
 * Les primitives vendored (`src/components/ui/**`) et `globals.css` sont exclus via la
 * config ESLint.
 */

// Une valeur arbitraire `-[…]` contenant une couleur codée en dur (hex n'importe où,
// ou fonction rgb/hsl à arguments bruts). Les fonctions à base de var (oklch/color-mix
// tokenisés) ne sont volontairement pas ciblées ici pour éviter les faux positifs.
const COLOR_IN_ARBITRARY =
  /-\[[^\]]*(?:#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\()[^\]]*\]/i;

// Une valeur arbitraire d'espacement/dimension avec une longueur littérale.
const SPACING_UTILITY_ARBITRARY =
  /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|w|h|min-w|min-h|max-w|max-h|size|basis)-\[-?\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|%|ch|ex)\]/;

// Couleur littérale dans une valeur de `style` inline.
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\(/i;

const CLASS_HELPERS = new Set([
  "cn",
  "cva",
  "clsx",
  "tv",
  "twMerge",
  "twJoin",
  "classNames",
]);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Interdit les couleurs/espacements codés en dur ; référencer les tokens du design-system.",
    },
    schema: [],
    messages: {
      hardcodedColorClass:
        "Couleur codée en dur dans une classe Tailwind ({{match}}). Utiliser un token sémantique (ex. bg-primary, text-muted-foreground).",
      hardcodedSpacingClass:
        "Espacement codé en dur dans une classe Tailwind ({{match}}). Utiliser l'échelle base-4 (ex. p-4, gap-2) ou un token (ex. size-(--tap-min)).",
      hardcodedColorStyle:
        "Couleur codée en dur dans un style inline. Référencer une variable de token (var(--...)) ou une classe utilitaire.",
    },
  },

  create(context) {
    /** @param {import("eslint").Rule.Node} node @param {string} value */
    function checkClassString(node, value) {
      const color = COLOR_IN_ARBITRARY.exec(value);
      if (color) {
        context.report({
          node,
          messageId: "hardcodedColorClass",
          data: { match: color[0] },
        });
      }
      const spacing = SPACING_UTILITY_ARBITRARY.exec(value);
      if (spacing) {
        context.report({
          node,
          messageId: "hardcodedSpacingClass",
          data: { match: spacing[0] },
        });
      }
    }

    // Extrait les chaînes de classes d'une expression (littéraux, templates,
    // ternaires, logiques, tableaux). Les appels (cn/cva…) sont traités par le
    // visiteur CallExpression → on n'y descend pas ici.
    /** @param {import("estree").Node | null | undefined} expr */
    function collectClassStrings(expr) {
      if (!expr) return;
      switch (expr.type) {
        case "Literal":
          if (typeof expr.value === "string")
            checkClassString(expr, expr.value);
          break;
        case "TemplateLiteral":
          for (const q of expr.quasis) {
            if (typeof q.value.cooked === "string")
              checkClassString(q, q.value.cooked);
          }
          break;
        case "ConditionalExpression":
          collectClassStrings(expr.consequent);
          collectClassStrings(expr.alternate);
          break;
        case "LogicalExpression":
          collectClassStrings(expr.left);
          collectClassStrings(expr.right);
          break;
        case "ArrayExpression":
          for (const el of expr.elements) collectClassStrings(el);
          break;
        default:
          break;
      }
    }

    /** @param {import("estree").Node} styleExpr */
    function checkInlineStyle(styleExpr) {
      let expr = styleExpr;
      if (expr && expr.type === "TSAsExpression") expr = expr.expression;
      if (!expr || expr.type !== "ObjectExpression") return;

      for (const prop of expr.properties) {
        if (prop.type !== "Property") continue;
        // Clé calculée non littérale (`["--" + x]`) → indécidable, on ne signale pas.
        if (prop.computed && prop.key.type !== "Literal") continue;

        let keyName = null;
        if (prop.key.type === "Identifier") keyName = prop.key.name;
        else if (prop.key.type === "Literal") keyName = String(prop.key.value);
        // Injection de variable CSS (branding hôtel) : autorisée.
        if (keyName && keyName.startsWith("--")) continue;

        if (
          prop.value.type !== "Literal" ||
          typeof prop.value.value !== "string"
        )
          continue;
        const v = prop.value.value;
        if (v.includes("var(")) continue;
        if (COLOR_LITERAL.test(v)) {
          context.report({ node: prop, messageId: "hardcodedColorStyle" });
        }
      }
    }

    return {
      JSXAttribute(node) {
        const attrName = node.name && node.name.name;
        const value = node.value;
        if (attrName === "className") {
          if (!value) return;
          if (value.type === "Literal" && typeof value.value === "string") {
            checkClassString(value, value.value);
          } else if (value.type === "JSXExpressionContainer") {
            collectClassStrings(value.expression);
          }
        } else if (attrName === "style") {
          if (value && value.type === "JSXExpressionContainer") {
            checkInlineStyle(value.expression);
          }
        }
      },

      CallExpression(node) {
        const callee = node.callee;
        const name = callee.type === "Identifier" ? callee.name : null;
        if (!name || !CLASS_HELPERS.has(name)) return;
        for (const arg of node.arguments) collectClassStrings(arg);
      },
    };
  },
};

export default rule;
