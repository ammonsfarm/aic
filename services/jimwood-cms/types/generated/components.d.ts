import type { Schema, Struct } from '@strapi/strapi';

export interface ContentExternalLink extends Struct.ComponentSchema {
  collectionName: 'components_content_external_links';
  info: {
    description: 'A labeled external or internal resource link';
    displayName: 'External link';
  };
  attributes: {
    description: Schema.Attribute.Text;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ContentScriptureReference extends Struct.ComponentSchema {
  collectionName: 'components_content_scripture_references';
  info: {
    description: 'A normalized Bible passage reference attached to editorial content';
    displayName: 'Scripture reference';
  };
  attributes: {
    book: Schema.Attribute.String;
    chapter: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    translation: Schema.Attribute.String & Schema.Attribute.DefaultTo<'ESV'>;
    url: Schema.Attribute.String;
    verseEnd: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    verseStart: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
  };
}

export interface NavigationNavigationItem extends Struct.ComponentSchema {
  collectionName: 'components_navigation_navigation_items';
  info: {
    displayName: 'navigationItem';
  };
  attributes: {
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    order: Schema.Attribute.Integer;
    page: Schema.Attribute.Relation<'oneToOne', 'api::page.page'>;
    url: Schema.Attribute.String;
  };
}

export interface PageSectionsCtaSection extends Struct.ComponentSchema {
  collectionName: 'components_page_sections_cta_sections';
  info: {
    displayName: 'CTA Section';
  };
  attributes: {
    body: Schema.Attribute.Text;
    buttonLabel: Schema.Attribute.String;
    buttonUrl: Schema.Attribute.String;
    eyebrow: Schema.Attribute.String;
    heading: Schema.Attribute.String;
  };
}

export interface PageSectionsImageTextSection extends Struct.ComponentSchema {
  collectionName: 'components_page_sections_image_text_sections';
  info: {
    displayName: 'Image Text Section';
  };
  attributes: {
    body: Schema.Attribute.RichText;
    eyebrow: Schema.Attribute.String;
    heading: Schema.Attribute.String;
    image: Schema.Attribute.Media<'images'>;
    imageDescription: Schema.Attribute.Text;
    imageSide: Schema.Attribute.Enumeration<['none', 'left', 'right']> &
      Schema.Attribute.DefaultTo<'right'>;
  };
}

export interface PageSectionsTextSection extends Struct.ComponentSchema {
  collectionName: 'components_page_sections_text_sections';
  info: {
    displayName: 'Text Section';
  };
  attributes: {
    body: Schema.Attribute.RichText;
    eyebrow: Schema.Attribute.String;
    heading: Schema.Attribute.String;
  };
}

export interface SeoMetadata extends Struct.ComponentSchema {
  collectionName: 'components_seo_metadata';
  info: {
    description: 'Search and social sharing metadata';
    displayName: 'SEO metadata';
  };
  attributes: {
    canonicalUrl: Schema.Attribute.String;
    description: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 180;
      }>;
    noIndex: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    socialImage: Schema.Attribute.Media<'images'>;
    title: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 70;
      }>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'content.external-link': ContentExternalLink;
      'content.scripture-reference': ContentScriptureReference;
      'navigation.navigation-item': NavigationNavigationItem;
      'page-sections.cta-section': PageSectionsCtaSection;
      'page-sections.image-text-section': PageSectionsImageTextSection;
      'page-sections.text-section': PageSectionsTextSection;
      'seo.metadata': SeoMetadata;
    }
  }
}
