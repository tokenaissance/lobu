import { useSettings } from "../app";
import { Section } from "./Section";

export function InstructionsSection({ adminOnly }: { adminOnly?: boolean }) {
  const ctx = useSettings();

  return (
    <Section
      id="instructions"
      title="Instructions"
      icon="&#128220;"
      adminOnly={adminOnly}
    >
      <div class="space-y-3">
        <div>
          <label
            htmlFor="identity-md"
            class="block text-xs font-medium text-gray-700 mb-1"
          >
            IDENTITY.md <span class="text-gray-400">- Who the agent is</span>
          </label>
          <textarea
            id="identity-md"
            value={ctx.identityMd.value}
            onInput={(e) => {
              ctx.identityMd.value = (e.target as HTMLTextAreaElement).value;
            }}
            placeholder={
              "You are a helpful coding assistant named Alex.\nYou specialize in TypeScript and React development."
            }
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="soul-md"
            class="block text-xs font-medium text-gray-700 mb-1"
          >
            SOUL.md{" "}
            <span class="text-gray-400">
              - Behavior rules &amp; instructions
            </span>
          </label>
          <textarea
            id="soul-md"
            value={ctx.soulMd.value}
            onInput={(e) => {
              ctx.soulMd.value = (e.target as HTMLTextAreaElement).value;
            }}
            placeholder={
              "Always write tests before implementation.\nPrefer functional programming patterns.\nNever commit directly to main branch."
            }
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[80px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="user-md"
            class="block text-xs font-medium text-gray-700 mb-1"
          >
            USER.md <span class="text-gray-400">- User-specific context</span>
          </label>
          <textarea
            id="user-md"
            value={ctx.userMd.value}
            onInput={(e) => {
              ctx.userMd.value = (e.target as HTMLTextAreaElement).value;
            }}
            placeholder={
              "The user prefers concise responses.\nTheir timezone is UTC+3.\nThey use VS Code as their IDE."
            }
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono min-h-[60px] resize-y focus:border-slate-600 focus:ring-1 focus:ring-slate-200 outline-none"
          />
        </div>
      </div>
    </Section>
  );
}
