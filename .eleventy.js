const { DateTime } = require('luxon');
const path = require('path');

module.exports = function(eleventyConfig) {
  const Nunjucks = require('nunjucks');
  const nunjucksEnvironment = new Nunjucks.Environment(
    new Nunjucks.FileSystemLoader([
      path.join(__dirname, 'src/_includes'),
      path.join(__dirname, 'src')
    ])
  );

  nunjucksEnvironment.addFilter('date', function(dateObj, format) {
    if (!dateObj) return '';
    format = format || 'yyyy-MM-dd';
    const date = dateObj === 'now' ? new Date() : (typeof dateObj === 'string' ? new Date(dateObj) : dateObj);
    return DateTime.fromJSDate(date, { zone: 'utc' }).toFormat(format);
  });

  eleventyConfig.setLibrary('njk', nunjucksEnvironment);

  eleventyConfig.addPassthroughCopy({ "assets": "assets" });
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy("_headers");
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });
  eleventyConfig.addPassthroughCopy({ "src/.well-known": ".well-known" });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    templateFormats: ["html", "njk", "md"]
  };
};
