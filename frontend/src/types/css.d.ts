/**
 * Cho phép `import "…/style.css"` trong TS.
 *
 * Cần vì `@harbour-enterprises/superdoc` xuất `./style.css` qua exports map
 * nhưng không kèm khai báo type. Không có file này thì phải né bằng dynamic
 * import — và khi đó Next không bundle CSS, giao diện SuperDoc mất style.
 */
declare module "*.css";
