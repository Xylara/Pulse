module.exports = (req, res, next) => {
  if (!req.session.user) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(401).json({ error: 'Unauthorized: Please log in again.' });
    } else {
      return res.redirect('/login');
    }
  }
  next();
};