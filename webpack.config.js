const path = require("path");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

// Load environment variables from .env file
const dotenv = require("dotenv");
const Dotenv = require("dotenv-webpack");
dotenv.config();

// Check if we are in development mode
const isDevelopment = process.env.NODE_ENV === "development";

// Suppressor paths
const transformersSuppressor = path.resolve(
  __dirname,
  "src/common/transformers-warn-suppressor.js",
);
const litSuppressor = path.resolve(
  __dirname,
  "src/common/lit-dev-warn-suppressor.js",
);

module.exports = {
  entry: {
    contentScript: path.resolve("src/contentScript/controller.js"),
    background: path.resolve("src/background/background.js"),
    sidepanel: [
      transformersSuppressor,
      litSuppressor,
      path.resolve("src/sidepanel/sidepanel.js"),
    ],
  },

  devtool: isDevelopment ? "inline-source-map" : undefined,

  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(jpg|jpeg|png|woff|woff2|eot|ttf|svg)$/,
        type: "asset/resource",
      },
      {
        test: /\.html?$/,
        use: "html-loader",
      },
    ],
  },

  plugins: [
    new Dotenv({
      path: process.env.ENV_PATH,
      systemvars: true,
    }),

    new CleanWebpackPlugin({
      cleanStaleWebpackAssets: false,
    }),

    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, "src/sidepanel/sidepanel.html"),
      filename: "sidepanel.html",
      chunks: ["sidepanel"],
      inject: "body",
    }),

    new CopyWebpackPlugin({
      patterns: [
        {
          from: "src/images",
          to: "images/[name][ext]",
        },

        {
          from: "src/manifest.json",
          to: "[name][ext]",
        },

        {
          from: path.resolve(
            __dirname,
            "node_modules/@xenova/transformers/dist/ort-wasm-simd.wasm",
          ),
          to: "runtime/[name][ext]",
        },

        {
          from: path.resolve(
            __dirname,
            "node_modules/@xenova/transformers/dist/ort-wasm.wasm",
          ),
          to: "runtime/[name][ext]",
        },
      ],
    }),
  ],

  resolve: {
    extensions: [".js"],
  },

  output: {
    filename: "[name].js",
    chunkFilename: "chunk-[id].js",
    path: path.resolve(__dirname, "dist"),
  },
};
