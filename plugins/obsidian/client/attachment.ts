import { defineAttachmentSource } from "@getpaseo/plugin";
import { searchRpc } from "../shared/contracts";
import { copy } from "./status";

export const attachmentSource = defineAttachmentSource({
  id: "vault",
  title: copy.title,
  icon: "Notebook",
  pickerTitle: copy.aside.title,
  searchPlaceholder: copy.aside.searchPlaceholder,
  search: searchRpc,
});
