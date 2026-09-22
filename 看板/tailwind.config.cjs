module.exports = {
  "darkMode": "class",
  "theme": {
    "extend": {
      "colors": {
        "surface-container-low": "#f3f3f4",
        "secondary-fixed": "#e5e2e1",
        "on-surface-variant": "#444936",
        "on-error": "#ffffff",
        "surface-bright": "#f9f9fa",
        "secondary": "#5f5e5e",
        "inverse-surface": "#2f3132",
        "surface-tint": "#4f6600",
        "on-tertiary": "#ffffff",
        "surface-container": "#eeeeef",
        "on-secondary": "#ffffff",
        "outline": "#757964",
        "primary-fixed": "#c8f252",
        "inverse-primary": "#acd537",
        "surface-container-high": "#e8e8e9",
        "primary-fixed-dim": "#acd537",
        "surface-container-highest": "#e2e2e3",
        "on-secondary-fixed-variant": "#474746",
        "surface-variant": "#e2e2e3",
        "tertiary-fixed": "#e1e0ff",
        "on-secondary-container": "#636262",
        "on-primary": "#ffffff",
        "surface": "#f9f9fa",
        "primary": "#4f6600",
        "tertiary-fixed-dim": "#c0c1ff",
        "on-surface": "#1a1c1d",
        "error-container": "#ffdad6",
        "background": "#f9f9fa",
        "on-primary-fixed-variant": "#3b4d00",
        "on-tertiary-fixed": "#07006c",
        "surface-container-lowest": "#ffffff",
        "on-primary-fixed": "#161f00",
        "on-tertiary-container": "#575ae5",
        "on-secondary-fixed": "#1c1b1b",
        "surface-dim": "#dadadb",
        "tertiary": "#494bd6",
        "primary-container": "#d4ff5e",
        "tertiary-container": "#f0edff",
        "outline-variant": "#c5c9b0",
        "on-error-container": "#93000a",
        "error": "#ba1a1a",
        "secondary-container": "#e2dfde",
        "on-primary-container": "#5b7500",
        "on-tertiary-fixed-variant": "#2f2ebe",
        "on-background": "#1a1c1d",
        "secondary-fixed-dim": "#c8c6c5",
        "inverse-on-surface": "#f0f1f2"
      },
      "borderRadius": {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      "spacing": {
        "sidebar-expanded": "240px",
        "gutter": "24px",
        "container-padding-mobile": "16px",
        "container-padding-desktop": "32px",
        "sidebar-width": "80px",
        "base": "8px"
      },
      "fontFamily": {
        "metric-xl": [
          "Hanken Grotesk"
        ],
        "headline-lg": [
          "Hanken Grotesk"
        ],
        "display-lg": [
          "Hanken Grotesk"
        ],
        "label-sm": [
          "JetBrains Mono"
        ],
        "headline-lg-mobile": [
          "Hanken Grotesk"
        ],
        "body-md": [
          "Manrope"
        ]
      },
      "fontSize": {
        "metric-xl": [
          "40px",
          {
            "lineHeight": "48px",
            "letterSpacing": "-0.03em",
            "fontWeight": "700"
          }
        ],
        "headline-lg": [
          "32px",
          {
            "lineHeight": "40px",
            "letterSpacing": "-0.01em",
            "fontWeight": "600"
          }
        ],
        "display-lg": [
          "48px",
          {
            "lineHeight": "56px",
            "letterSpacing": "-0.02em",
            "fontWeight": "700"
          }
        ],
        "label-sm": [
          "12px",
          {
            "lineHeight": "16px",
            "letterSpacing": "0.05em",
            "fontWeight": "500"
          }
        ],
        "headline-lg-mobile": [
          "24px",
          {
            "lineHeight": "32px",
            "fontWeight": "600"
          }
        ],
        "body-md": [
          "16px",
          {
            "lineHeight": "24px",
            "fontWeight": "400"
          }
        ]
      }
    }
  },
  "content": [
    "./index.html",
    "./app.js"
  ]
};
module.exports.plugins = [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')];
