import { damageButtons } from "../health.mjs";

/**
 * Chat messages: damage rolls get buttons to apply the damage (module/health.mjs). The buttons are added to the
 * rendered element in renderHTML, as dnd5e's ChatMessage5e#renderHTML does on Foundry v14.
 */
export default class AD2EChatMessage extends ChatMessage {
  /** @inheritDoc */
  async renderHTML(options = {}) {
    const html = await super.renderHTML(options);
    damageButtons(this, html);
    return html;
  }
}
