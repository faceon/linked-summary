import { LitElement, html, css } from "lit";

export class KeyPoint extends LitElement {
  static properties = {};

  static styles = css`
    :host {
      display: block;
      color: var(--md-list-item-label-text-color, #202124);
      margin-bottom: 0.2rem;
    }

    .item {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 0.6rem;
      row-gap: 0.35rem;
      padding-block: 0.3rem;
      align-items: flex-start;
    }

    :host(:first-of-type) .item {
      padding-top: 0;
    }

    :host(:last-of-type) .item {
      padding-bottom: 0;
    }

    .bullet {
      font-size: 0.75rem;
      font-weight: 600;
      align-self: flex-start;
      margin-top: 0.15rem;
    }

    .content {
      font-size: 0.85rem;
      display: block;
      line-height: 1.45;
    }

    ::slotted(*) {
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: normal;
    }

    ::slotted(.key-point-text) {
      display: inline;
      line-height: 1.35;
      letter-spacing: 0.01em;
      margin-right: 0.35rem;
    }

    ::slotted(target-link) {
      display: inline-flex;
      vertical-align: baseline;
      margin-left: 0.15rem;
    }
  `;

  render() {
    return html`
      <article class="item">
        <span class="bullet" aria-hidden="true">•</span>
        <div class="content">
          <slot></slot>
        </div>
      </article>
    `;
  }
}
