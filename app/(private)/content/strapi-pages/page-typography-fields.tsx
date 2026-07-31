import {
  PAGE_FONT_SIZE_OPTIONS,
  type PageFontSize,
} from "@/lib/page-typography";

type PageTypographyFieldsProps = {
  heroTitleSize?: PageFontSize;
  heroBodySize?: PageFontSize;
  sectionHeadingSize?: PageFontSize;
  sectionBodySize?: PageFontSize;
};

function FontSizeSelect({
  name,
  label,
  help,
  value = "standard",
}: {
  name: string;
  label: string;
  help: string;
  value?: PageFontSize;
}) {
  return (
    <label>
      <span>{label}</span>
      <select name={name} defaultValue={value}>
        {PAGE_FONT_SIZE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} — {option.description}
          </option>
        ))}
      </select>
      <small>{help}</small>
    </label>
  );
}

export function PageTypographyFields(props: PageTypographyFieldsProps) {
  return (
    <fieldset className="editor-field-group">
      <legend>Page font sizes</legend>
      <p className="muted">Choose responsive presets for this page. Standard is recommended; every option remains readable on phones and at browser zoom.</p>
      <div className="editor-grid editor-grid--two">
        <FontSizeSelect name="heroTitleSize" label="Main title size" help="Controls the large title at the top of this page." value={props.heroTitleSize} />
        <FontSizeSelect name="heroBodySize" label="Intro text size" help="Controls the short introduction below the main title." value={props.heroBodySize} />
        <FontSizeSelect name="sectionHeadingSize" label="Section heading size" help="Controls headings in the page-builder sections below the introduction." value={props.sectionHeadingSize} />
        <FontSizeSelect name="sectionBodySize" label="Section text size" help="Controls paragraphs and lists in the page-builder sections." value={props.sectionBodySize} />
      </div>
    </fieldset>
  );
}
