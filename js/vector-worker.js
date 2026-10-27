var PotraceBrowser=(function(){const modules={"Potrace":function(module,exports,require){
'use strict';

var Jimp = function JimpUnavailable() { throw new Error("Use raw pixel adapter"); };
var Bitmap = require("types/Bitmap");
var Curve = require("types/Curve");
var Point = require("types/Point");
var Path = require("types/Path");
var Quad = require("types/Quad");
var Sum = require("types/Sum");
var Opti = require("types/Opti");

var utils = require("utils");

/**
 * Potrace class
 *
 * @param {Potrace~Options} [options]
 * @constructor
 */
function Potrace (options) {
  this._luminanceData = null;
  this._pathlist = [];

  this._imageLoadingIdentifier = null;
  this._imageLoaded = false;
  this._processed = false;

  this._params = {
    turnPolicy: Potrace.TURNPOLICY_MINORITY,
    turdSize: 2,
    alphaMax: 1,
    optCurve: true,
    optTolerance: 0.2,
    threshold: Potrace.THRESHOLD_AUTO,
    blackOnWhite: true,
    color: Potrace.COLOR_AUTO,
    background: Potrace.COLOR_TRANSPARENT,
    width: null,
    height: null
  };

  if (options) {
    this.setParameters(options);
  }
}

Potrace.COLOR_AUTO = 'auto';
Potrace.COLOR_TRANSPARENT = 'transparent';
Potrace.THRESHOLD_AUTO = -1;
Potrace.TURNPOLICY_BLACK = 'black';
Potrace.TURNPOLICY_WHITE = 'white';
Potrace.TURNPOLICY_LEFT = 'left';
Potrace.TURNPOLICY_RIGHT = 'right';
Potrace.TURNPOLICY_MINORITY = 'minority';
Potrace.TURNPOLICY_MAJORITY = 'majority';

var SUPPORTED_TURNPOLICY_VALUES = [
  Potrace.TURNPOLICY_BLACK, Potrace.TURNPOLICY_WHITE,
  Potrace.TURNPOLICY_LEFT, Potrace.TURNPOLICY_RIGHT,
  Potrace.TURNPOLICY_MINORITY, Potrace.TURNPOLICY_MAJORITY
];

Potrace.prototype = {
  /**
   * Creating a new {@link Path} for every group of black pixels.
   * @private
   */
  _bmToPathlist: function() {
    var self = this,
        threshold = this._params.threshold,
        blackOnWhite = this._params.blackOnWhite,
        blackMap,
        currentPoint = new Point(0, 0),
        path;

    if (threshold === Potrace.THRESHOLD_AUTO) {
      threshold = this._luminanceData.histogram().autoThreshold() || 128;
    }

    blackMap = this._luminanceData.copy(function(lum) {
      var pastTheThreshold = blackOnWhite
        ? lum > threshold
        : lum < threshold;

      return pastTheThreshold ? 0 : 1;
    });
      
    /**
     * finds next black pixel of the image
     *
     * @param {Point} point
     * @returns {boolean}
     * @private
     */
    function findNext(point) {
      var i = blackMap.pointToIndex(point);

      while (i < blackMap.size && blackMap.data[i] !== 1) {
        i++;
      }

      return i < blackMap.size && blackMap.indexToPoint(i);
    }

    function majority(x, y) {
      var i, a, ct;

      for (i = 2; i < 5; i++) {
        ct = 0;
        for (a = -i + 1; a <= i - 1; a++) {
          ct += blackMap.getValueAt(x + a, y + i - 1) ? 1 : -1;
          ct += blackMap.getValueAt(x + i - 1, y + a - 1) ? 1 : -1;
          ct += blackMap.getValueAt(x + a - 1, y - i) ? 1 : -1;
          ct += blackMap.getValueAt(x - i, y + a) ? 1 : -1;
        }

        if (ct > 0) {
          return 1;
        } else if (ct < 0) {
          return 0;
        }
      }
      return 0;
    }

    function findPath(point) {
      var path = new Path(),
          x = point.x,
          y = point.y,
          dirx = 0,
          diry = 1,
          tmp;

      path.sign = blackMap.getValueAt(point.x, point.y) ? "+" : "-";

      while (1) {
        path.pt.push(new Point(x, y));
        if (x > path.maxX)
          path.maxX = x;
        if (x < path.minX)
          path.minX = x;
        if (y > path.maxY)
          path.maxY = y;
        if (y < path.minY)
          path.minY = y;
        path.len++;

        x += dirx;
        y += diry;
        path.area -= x * diry;

        if (x === point.x && y === point.y)
          break;

        var l = blackMap.getValueAt(x + (dirx + diry - 1 ) / 2, y + (diry - dirx - 1) / 2);
        var r = blackMap.getValueAt(x + (dirx - diry - 1) / 2, y + (diry + dirx - 1) / 2);

        if (r && !l) {
          if (self._params.turnPolicy === "right" ||
            (self._params.turnPolicy === "black" && path.sign === '+') ||
            (self._params.turnPolicy === "white" && path.sign === '-') ||
            (self._params.turnPolicy === "majority" && majority(x, y)) ||
            (self._params.turnPolicy === "minority" && !majority(x, y))) {
            tmp = dirx;
            dirx = -diry;
            diry = tmp;
          } else {
            tmp = dirx;
            dirx = diry;
            diry = -tmp;
          }
        } else if (r) {
          tmp = dirx;
          dirx = -diry;
          diry = tmp;
        } else if (!l) {
          tmp = dirx;
          dirx = diry;
          diry = -tmp;
        }
      }
      return path;
    }

    function xorPath(path){
      var y1 = path.pt[0].y,
        len = path.len,
        x, y, maxX, minY, i, j,
        indx;

      for (i = 1; i < len; i++) {
        x = path.pt[i].x;
        y = path.pt[i].y;

        if (y !== y1) {
          minY = y1 < y ? y1 : y;
          maxX = path.maxX;
          for (j = x; j < maxX; j++) {
            indx = blackMap.pointToIndex(j, minY);
            blackMap.data[indx] = blackMap.data[indx] ? 0 : 1;
          }
          y1 = y;
        }
      }
    }

    // Clear path list
    this._pathlist = [];

    while (currentPoint = findNext(currentPoint)) {
      path = findPath(currentPoint);
      xorPath(path);

      if (path.area > self._params.turdSize || (self._keep && self._keep(path))) {
        this._pathlist.push(path);
      }
    }
  },

  /**
   * Processes path list created by _bmToPathlist method creating and optimizing {@link Curve}'s
   * @private
   */
  _processPath: function() {
    var self = this;

    function calcSums(path) {
      var i, x, y;
      path.x0 = path.pt[0].x;
      path.y0 = path.pt[0].y;

      path.sums = [];
      var s = path.sums;
      s.push(new Sum(0, 0, 0, 0, 0));
      for(i = 0; i < path.len; i++){
        x = path.pt[i].x - path.x0;
        y = path.pt[i].y - path.y0;
        s.push(new Sum(s[i].x + x, s[i].y + y, s[i].xy + x * y,
            s[i].x2 + x * x, s[i].y2 + y * y));
      }
    }

    function calcLon(path) {

      var n = path.len,
          pt = path.pt,
          dir,
          pivk = new Array(n),
          nc = new Array(n),
          ct = new Array(4);

      path.lon = new Array(n);

      var constraint = [new Point(), new Point()],
          cur = new Point(),
          off = new Point(),
          dk = new Point(),
          foundk;

      var i, j, k1, a, b, c, d, k = 0;
      for(i = n - 1; i >= 0; i--){
        if (pt[i].x != pt[k].x && pt[i].y != pt[k].y) {
          k = i + 1;
        }
        nc[i] = k;
      }

      for (i = n - 1; i >= 0; i--) {
        ct[0] = ct[1] = ct[2] = ct[3] = 0;
        dir = (3 + 3 * (pt[utils.mod(i + 1, n)].x - pt[i].x) +
            (pt[utils.mod(i + 1, n)].y - pt[i].y)) / 2;
        ct[dir]++;

        constraint[0].x = 0;
        constraint[0].y = 0;
        constraint[1].x = 0;
        constraint[1].y = 0;

        k = nc[i];
        k1 = i;
        while (1) {
          foundk = 0;
          dir =  (3 + 3 * utils.sign(pt[k].x - pt[k1].x) +
              utils.sign(pt[k].y - pt[k1].y)) / 2;
          ct[dir]++;

          if (ct[0] && ct[1] && ct[2] && ct[3]) {
            pivk[i] = k1;
            foundk = 1;
            break;
          }

          cur.x = pt[k].x - pt[i].x;
          cur.y = pt[k].y - pt[i].y;

          if (utils.xprod(constraint[0], cur) < 0 || utils.xprod(constraint[1], cur) > 0) {
            break;
          }

          if (Math.abs(cur.x) <= 1 && Math.abs(cur.y) <= 1) {

          } else {
            off.x = cur.x + ((cur.y >= 0 && (cur.y > 0 || cur.x < 0)) ? 1 : -1);
            off.y = cur.y + ((cur.x <= 0 && (cur.x < 0 || cur.y < 0)) ? 1 : -1);
            if (utils.xprod(constraint[0], off) >= 0) {
              constraint[0].x = off.x;
              constraint[0].y = off.y;
            }
            off.x = cur.x + ((cur.y <= 0 && (cur.y < 0 || cur.x < 0)) ? 1 : -1);
            off.y = cur.y + ((cur.x >= 0 && (cur.x > 0 || cur.y < 0)) ? 1 : -1);
            if (utils.xprod(constraint[1], off) <= 0) {
              constraint[1].x = off.x;
              constraint[1].y = off.y;
            }
          }
          k1 = k;
          k = nc[k1];
          if (!utils.cyclic(k, i, k1)) {
            break;
          }
        }
        if (foundk === 0) {
          dk.x = utils.sign(pt[k].x-pt[k1].x);
          dk.y = utils.sign(pt[k].y-pt[k1].y);
          cur.x = pt[k1].x - pt[i].x;
          cur.y = pt[k1].y - pt[i].y;

          a = utils.xprod(constraint[0], cur);
          b = utils.xprod(constraint[0], dk);
          c = utils.xprod(constraint[1], cur);
          d = utils.xprod(constraint[1], dk);

          j = 10000000;

          if (b < 0) {
            j = Math.floor(a / -b);
          }
          if (d > 0) {
            j = Math.min(j, Math.floor(-c / d));
          }

          pivk[i] = utils.mod(k1+j,n);
        }
      }

      j=pivk[n-1];
      path.lon[n-1]=j;
      for (i=n-2; i>=0; i--) {
        if (utils.cyclic(i+1,pivk[i],j)) {
          j=pivk[i];
        }
        path.lon[i]=j;
      }

      for (i=n-1; utils.cyclic(utils.mod(i+1,n),j,path.lon[i]); i--) {
        path.lon[i] = j;
      }
    }

    function bestPolygon(path) {

      function penalty3(path, i, j) {

        var n = path.len, pt = path.pt, sums = path.sums;
        var x, y, xy, x2, y2,
          k, a, b, c, s,
          px, py, ex, ey,
          r = 0;
        if (j>=n) {
          j -= n;
          r = 1;
        }

        if (r === 0) {
          x = sums[j+1].x - sums[i].x;
          y = sums[j+1].y - sums[i].y;
          x2 = sums[j+1].x2 - sums[i].x2;
          xy = sums[j+1].xy - sums[i].xy;
          y2 = sums[j+1].y2 - sums[i].y2;
          k = j+1 - i;
        } else {
          x = sums[j+1].x - sums[i].x + sums[n].x;
          y = sums[j+1].y - sums[i].y + sums[n].y;
          x2 = sums[j+1].x2 - sums[i].x2 + sums[n].x2;
          xy = sums[j+1].xy - sums[i].xy + sums[n].xy;
          y2 = sums[j+1].y2 - sums[i].y2 + sums[n].y2;
          k = j+1 - i + n;
        }

        px = (pt[i].x + pt[j].x) / 2.0 - pt[0].x;
        py = (pt[i].y + pt[j].y) / 2.0 - pt[0].y;
        ey = (pt[j].x - pt[i].x);
        ex = -(pt[j].y - pt[i].y);

        a = ((x2 - 2*x*px) / k + px*px);
        b = ((xy - x*py - y*px) / k + px*py);
        c = ((y2 - 2*y*py) / k + py*py);

        s = ex*ex*a + 2*ex*ey*b + ey*ey*c;

        return Math.sqrt(s);
      }

      var i, j, m, k,
      n = path.len,
      pen = new Array(n + 1),
      prev = new Array(n + 1),
      clip0 = new Array(n),
      clip1 = new Array(n + 1),
      seg0 = new Array (n + 1),
      seg1 = new Array(n + 1),
      thispen, best, c;

      for (i=0; i<n; i++) {
        c = utils.mod(path.lon[utils.mod(i-1,n)]-1,n);
        if (c == i) {
          c = utils.mod(i+1,n);
        }
        if (c < i) {
          clip0[i] = n;
        } else {
          clip0[i] = c;
        }
      }

      j = 1;
      for (i=0; i<n; i++) {
        while (j <= clip0[i]) {
          clip1[j] = i;
          j++;
        }
      }

      i = 0;
      for (j=0; i<n; j++) {
        seg0[j] = i;
        i = clip0[i];
      }
      seg0[j] = n;
      m = j;

      i = n;
      for (j=m; j>0; j--) {
        seg1[j] = i;
        i = clip1[i];
      }
      seg1[0] = 0;

      pen[0]=0;
      for (j=1; j<=m; j++) {
        for (i=seg1[j]; i<=seg0[j]; i++) {
          best = -1;
          for (k=seg0[j-1]; k>=clip1[i]; k--) {
            thispen = penalty3(path, k, i) + pen[k];
            if (best < 0 || thispen < best) {
              prev[i] = k;
              best = thispen;
            }
          }
          pen[i] = best;
        }
      }
      path.m = m;
      path.po = new Array(m);

      for (i=n, j=m-1; i>0; j--) {
        i = prev[i];
        path.po[j] = i;
      }
    }

    function adjustVertices(path) {

      function pointslope(path, i, j, ctr, dir) {

        var n = path.len, sums = path.sums,
          x, y, x2, xy, y2,
          k, a, b, c, lambda2, l, r=0;

        while (j>=n) {
          j-=n;
          r+=1;
        }
        while (i>=n) {
          i-=n;
          r-=1;
        }
        while (j<0) {
          j+=n;
          r-=1;
        }
        while (i<0) {
          i+=n;
          r+=1;
        }

        x = sums[j+1].x-sums[i].x+r*sums[n].x;
        y = sums[j+1].y-sums[i].y+r*sums[n].y;
        x2 = sums[j+1].x2-sums[i].x2+r*sums[n].x2;
        xy = sums[j+1].xy-sums[i].xy+r*sums[n].xy;
        y2 = sums[j+1].y2-sums[i].y2+r*sums[n].y2;
        k = j+1-i+r*n;

        ctr.x = x/k;
        ctr.y = y/k;

        a = (x2-x*x/k)/k;
        b = (xy-x*y/k)/k;
        c = (y2-y*y/k)/k;

        lambda2 = (a+c+Math.sqrt((a-c)*(a-c)+4*b*b))/2;

        a -= lambda2;
        c -= lambda2;

        if (Math.abs(a) >= Math.abs(c)) {
          l = Math.sqrt(a*a+b*b);
          if (l!==0) {
            dir.x = -b/l;
            dir.y = a/l;
          }
        } else {
          l = Math.sqrt(c*c+b*b);
          if (l!==0) {
            dir.x = -c/l;
            dir.y = b/l;
          }
        }
        if (l===0) {
          dir.x = dir.y = 0;
        }
      }

      var m = path.m, po = path.po, n = path.len, pt = path.pt,
        x0 = path.x0, y0 = path.y0,
        ctr = new Array(m), dir = new Array(m),
        q = new Array(m),
        v = new Array(3), d, i, j, k, l,
        s = new Point();

      path.curve = new Curve(m);

      for (i=0; i<m; i++) {
        j = po[utils.mod(i+1,m)];
        j = utils.mod(j-po[i],n)+po[i];
        ctr[i] = new Point();
        dir[i] = new Point();
        pointslope(path, po[i], j, ctr[i], dir[i]);
      }

      for (i=0; i<m; i++) {
        q[i] = new Quad();
        d = dir[i].x * dir[i].x + dir[i].y * dir[i].y;
        if (d === 0.0) {
          for (j=0; j<3; j++) {
            for (k=0; k<3; k++) {
              q[i].data[j * 3 + k] = 0;
            }
          }
        } else {
          v[0] = dir[i].y;
          v[1] = -dir[i].x;
          v[2] = - v[1] * ctr[i].y - v[0] * ctr[i].x;
          for (l=0; l<3; l++) {
            for (k=0; k<3; k++) {
              q[i].data[l * 3 + k] = v[l] * v[k] / d;
            }
          }
        }
      }

      var Q, w, dx, dy, det, min, cand, xmin, ymin, z;
      for (i=0; i<m; i++) {
        Q = new Quad();
        w = new Point();

        s.x = pt[po[i]].x-x0;
        s.y = pt[po[i]].y-y0;

        j = utils.mod(i-1,m);

        for (l=0; l<3; l++) {
          for (k=0; k<3; k++) {
            Q.data[l * 3 + k] = q[j].at(l, k) + q[i].at(l, k);
          }
        }

        while(1) {

          det = Q.at(0, 0)*Q.at(1, 1) - Q.at(0, 1)*Q.at(1, 0);
          if (det !== 0.0) {
            w.x = (-Q.at(0, 2)*Q.at(1, 1) + Q.at(1, 2)*Q.at(0, 1)) / det;
            w.y = ( Q.at(0, 2)*Q.at(1, 0) - Q.at(1, 2)*Q.at(0, 0)) / det;
            break;
          }

          if (Q.at(0, 0)>Q.at(1, 1)) {
            v[0] = -Q.at(0, 1);
            v[1] = Q.at(0, 0);
          } else if (Q.at(1, 1)) {
            v[0] = -Q.at(1, 1);
            v[1] = Q.at(1, 0);
          } else {
            v[0] = 1;
            v[1] = 0;
          }
          d = v[0] * v[0] + v[1] * v[1];
          v[2] = - v[1] * s.y - v[0] * s.x;
          for (l=0; l<3; l++) {
            for (k=0; k<3; k++) {
              Q.data[l * 3 + k] += v[l] * v[k] / d;
            }
          }
        }
        dx = Math.abs(w.x-s.x);
        dy = Math.abs(w.y-s.y);
        if (dx <= 0.5 && dy <= 0.5) {
          path.curve.vertex[i] = new Point(w.x+x0, w.y+y0);
          continue;
        }

        min = utils.quadform(Q, s);
        xmin = s.x;
        ymin = s.y;

        if (Q.at(0, 0) !== 0.0) {
          for (z=0; z<2; z++) {
            w.y = s.y-0.5+z;
            w.x = - (Q.at(0, 1) * w.y + Q.at(0, 2)) / Q.at(0, 0);
            dx = Math.abs(w.x-s.x);
            cand = utils.quadform(Q, w);
            if (dx <= 0.5 && cand < min) {
              min = cand;
              xmin = w.x;
              ymin = w.y;
            }
          }
        }

        if (Q.at(1, 1) !== 0.0) {
          for (z=0; z<2; z++) {
            w.x = s.x-0.5+z;
            w.y = - (Q.at(1, 0) * w.x + Q.at(1, 2)) / Q.at(1, 1);
            dy = Math.abs(w.y-s.y);
            cand = utils.quadform(Q, w);
            if (dy <= 0.5 && cand < min) {
              min = cand;
              xmin = w.x;
              ymin = w.y;
            }
          }
        }

        for (l=0; l<2; l++) {
          for (k=0; k<2; k++) {
            w.x = s.x-0.5+l;
            w.y = s.y-0.5+k;
            cand = utils.quadform(Q, w);
            if (cand < min) {
              min = cand;
              xmin = w.x;
              ymin = w.y;
            }
          }
        }

        path.curve.vertex[i] = new Point(xmin + x0, ymin + y0);
      }
    }

    function reverse(path) {
      var curve = path.curve, m = curve.n, v = curve.vertex, i, j, tmp;

      for (i=0, j=m-1; i<j; i++, j--) {
        tmp = v[i];
        v[i] = v[j];
        v[j] = tmp;
      }
    }

    function smooth(path) {
      var m = path.curve.n, curve = path.curve;

      var i, j, k, dd, denom, alpha,
        p2, p3, p4;

      for (i=0; i<m; i++) {
        j = utils.mod(i+1, m);
        k = utils.mod(i+2, m);
        p4 = utils.interval(1/2.0, curve.vertex[k], curve.vertex[j]);

        denom = utils.ddenom(curve.vertex[i], curve.vertex[k]);
        if (denom !== 0.0) {
          dd = utils.dpara(curve.vertex[i], curve.vertex[j], curve.vertex[k]) / denom;
          dd = Math.abs(dd);
          alpha = dd>1 ? (1 - 1.0/dd) : 0;
          alpha = alpha / 0.75;
        } else {
          alpha = 4/3.0;
        }
        curve.alpha0[j] = alpha;

        // VektorKu V2 Pro 2026-10-10: perpotongan dua garis lurus yang terukur selalu menjadi sudut.
        if (alpha >= self._params.alphaMax || curve.vertex[j].sharp === true) {
          curve.tag[j] = "CORNER";
          curve.c[3 * j + 1] = curve.vertex[j];
          curve.c[3 * j + 2] = p4;
        } else {
          if (alpha < 0.55) {
            alpha = 0.55;
          } else if (alpha > 1) {
            alpha = 1;
          }
          p2 = utils.interval(0.5+0.5*alpha, curve.vertex[i], curve.vertex[j]);
          p3 = utils.interval(0.5+0.5*alpha, curve.vertex[k], curve.vertex[j]);
          curve.tag[j] = "CURVE";
          curve.c[3 * j + 0] = p2;
          curve.c[3 * j + 1] = p3;
          curve.c[3 * j + 2] = p4;
        }
        curve.alpha[j] = alpha;
        curve.beta[j] = 0.5;
      }
      curve.alphaCurve = 1;
    }

    function optiCurve(path) {

      function opti_penalty(path, i, j, res, opttolerance, convc, areac) {
        var m = path.curve.n, curve = path.curve, vertex = curve.vertex,
          k, k1, k2, conv, i1,
          area, alpha, d, d1, d2,
          p0, p1, p2, p3, pt,
          A, R, A1, A2, A3, A4,
          s, t;

        if (i==j) {
          return 1;
        }

        k = i;
        i1 = utils.mod(i+1, m);
        k1 = utils.mod(k+1, m);
        conv = convc[k1];
        if (conv === 0) {
          return 1;
        }
        d = utils.ddist(vertex[i], vertex[i1]);
        for (k=k1; k!=j; k=k1) {
          k1 = utils.mod(k+1, m);
          k2 = utils.mod(k+2, m);
          if (convc[k1] != conv) {
            return 1;
          }
          if (utils.sign(utils.cprod(vertex[i], vertex[i1], vertex[k1], vertex[k2])) !=
              conv) {
            return 1;
          }
          if (utils.iprod1(vertex[i], vertex[i1], vertex[k1], vertex[k2]) <
              d * utils.ddist(vertex[k1], vertex[k2]) * -0.999847695156) {
            return 1;
          }
        }

        p0 = curve.c[utils.mod(i,m) * 3 + 2].copy();
        p1 = vertex[utils.mod(i+1,m)].copy();
        p2 = vertex[utils.mod(j,m)].copy();
        p3 = curve.c[utils.mod(j,m) * 3 + 2].copy();

        area = areac[j] - areac[i];
        area -= utils.dpara(vertex[0], curve.c[i * 3 + 2], curve.c[j * 3 + 2])/2;
        if (i>=j) {
          area += areac[m];
        }

        A1 = utils.dpara(p0, p1, p2);
        A2 = utils.dpara(p0, p1, p3);
        A3 = utils.dpara(p0, p2, p3);

        A4 = A1+A3-A2;

        if (A2 == A1) {
          return 1;
        }

        t = A3/(A3-A4);
        s = A2/(A2-A1);
        A = A2 * t / 2.0;

        if (A === 0.0) {
          return 1;
        }

        R = area / A;
        alpha = 2 - Math.sqrt(4 - R / 0.3);

        res.c[0] = utils.interval(t * alpha, p0, p1);
        res.c[1] = utils.interval(s * alpha, p3, p2);
        res.alpha = alpha;
        res.t = t;
        res.s = s;

        p1 = res.c[0].copy();
        p2 = res.c[1].copy();

        res.pen = 0;

        for (k=utils.mod(i+1,m); k!=j; k=k1) {
          k1 = utils.mod(k+1,m);
          t = utils.tangent(p0, p1, p2, p3, vertex[k], vertex[k1]);
          if (t<-0.5) {
            return 1;
          }
          pt = utils.bezier(t, p0, p1, p2, p3);
          d = utils.ddist(vertex[k], vertex[k1]);
          if (d === 0.0) {
            return 1;
          }
          d1 = utils.dpara(vertex[k], vertex[k1], pt) / d;
          if (Math.abs(d1) > opttolerance) {
            return 1;
          }
          if (utils.iprod(vertex[k], vertex[k1], pt) < 0 ||
              utils.iprod(vertex[k1], vertex[k], pt) < 0) {
            return 1;
          }
          res.pen += d1 * d1;
        }

        for (k=i; k!=j; k=k1) {
          k1 = utils.mod(k+1,m);
          t = utils.tangent(p0, p1, p2, p3, curve.c[k * 3 + 2], curve.c[k1 * 3 + 2]);
          if (t<-0.5) {
            return 1;
          }
          pt = utils.bezier(t, p0, p1, p2, p3);
          d = utils.ddist(curve.c[k * 3 + 2], curve.c[k1 * 3 + 2]);
          if (d === 0.0) {
            return 1;
          }
          d1 = utils.dpara(curve.c[k * 3 + 2], curve.c[k1 * 3 + 2], pt) / d;
          d2 = utils.dpara(curve.c[k * 3 + 2], curve.c[k1 * 3 + 2], vertex[k1]) / d;
          d2 *= 0.75 * curve.alpha[k1];
          if (d2 < 0) {
            d1 = -d1;
            d2 = -d2;
          }
          if (d1 < d2 - opttolerance) {
            return 1;
          }
          if (d1 < d2) {
            res.pen += (d1 - d2) * (d1 - d2);
          }
        }

        return 0;
      }

      var curve = path.curve, m = curve.n, vert = curve.vertex,
          pt = new Array(m + 1),
          pen = new Array(m + 1),
          len = new Array(m + 1),
          opt = new Array(m + 1),
          om, i,j,r,
          o = new Opti(), p0,
          i1, area, alpha, ocurve,
          s, t;

      var convc = new Array(m), areac = new Array(m + 1);

      for (i=0; i<m; i++) {
        // VektorKu V2 Pro 2026-10-10: titik pada garis lurus terkunci tidak digabung (luas nol).
        if (curve.tag[i] == "CURVE" && vert[i].flat !== true) {
          convc[i] = utils.sign(utils.dpara(vert[utils.mod(i-1,m)], vert[i], vert[utils.mod(i+1,m)]));
        } else {
          convc[i] = 0;
        }
      }

      area = 0.0;
      areac[0] = 0.0;
      p0 = curve.vertex[0];
      for (i=0; i<m; i++) {
        i1 = utils.mod(i+1, m);
        if (curve.tag[i1] == "CURVE") {
          alpha = curve.alpha[i1];
          area += 0.3 * alpha * (4-alpha) *
              utils.dpara(curve.c[i * 3 + 2], vert[i1], curve.c[i1 * 3 + 2])/2;
          area += utils.dpara(p0, curve.c[i * 3 + 2], curve.c[i1 * 3 + 2])/2;
        }
        areac[i+1] = area;
      }

      pt[0] = -1;
      pen[0] = 0;
      len[0] = 0;


      for (j=1; j<=m; j++) {
        pt[j] = j-1;
        pen[j] = pen[j-1];
        len[j] = len[j-1]+1;

        for (i=j-2; i>=0; i--) {
          r = opti_penalty(path, i, utils.mod(j,m), o, self._params.optTolerance, convc,
              areac);
          if (r) {
            break;
          }
            if (len[j] > len[i]+1 ||
                (len[j] == len[i]+1 && pen[j] > pen[i] + o.pen)) {
              pt[j] = i;
              pen[j] = pen[i] + o.pen;
              len[j] = len[i] + 1;
              opt[j] = o;
              o = new Opti();
            }
        }
      }
      om = len[m];
      ocurve = new Curve(om);
      s = new Array(om);
      t = new Array(om);

      j = m;
      for (i=om-1; i>=0; i--) {
        if (pt[j]==j-1) {
          ocurve.tag[i]       = curve.tag[utils.mod(j,m)];
          ocurve.c[i * 3 + 0] = curve.c[utils.mod(j,m) * 3 + 0];
          ocurve.c[i * 3 + 1] = curve.c[utils.mod(j,m) * 3 + 1];
          ocurve.c[i * 3 + 2] = curve.c[utils.mod(j,m) * 3 + 2];
          ocurve.vertex[i]    = curve.vertex[utils.mod(j,m)];
          ocurve.alpha[i]     = curve.alpha[utils.mod(j,m)];
          ocurve.alpha0[i]    = curve.alpha0[utils.mod(j,m)];
          ocurve.beta[i]      = curve.beta[utils.mod(j,m)];
          s[i] = t[i] = 1.0;
        } else {
          ocurve.tag[i] = "CURVE";
          ocurve.c[i * 3 + 0] = opt[j].c[0];
          ocurve.c[i * 3 + 1] = opt[j].c[1];
          ocurve.c[i * 3 + 2] = curve.c[utils.mod(j,m) * 3 + 2];
          ocurve.vertex[i] = utils.interval(opt[j].s, curve.c[utils.mod(j,m) * 3 + 2],
                                       vert[utils.mod(j,m)]);
          ocurve.alpha[i] = opt[j].alpha;
          ocurve.alpha0[i] = opt[j].alpha;
          s[i] = opt[j].s;
          t[i] = opt[j].t;
        }
        j = pt[j];
      }

      for (i=0; i<om; i++) {
        i1 = utils.mod(i+1,om);
        ocurve.beta[i] = s[i] / (s[i] + t[i1]);
      }
      
      ocurve.alphaCurve = 1;
      path.curve = ocurve;
    }

    for (var i = 0; i < this._pathlist.length; i++) {
      var path = this._pathlist[i];
      calcSums(path);
      calcLon(path);
      // VektorKu V2 Pro 2026-10-10 (perubahan atas node-potrace 2.1.8): titik batas boleh digeser
      // ke posisi subpiksel sebelum poligon terbaik dan garis kuadrat-terkecil dihitung.
      if (typeof self._refinePoints === 'function') {
        self._refinePoints(path);
        calcSums(path);
      }
      bestPolygon(path);
      adjustVertices(path);
      // VektorKu V2 Pro 2026-10-10: sisi poligon yang terukur lurus boleh dikunci sebelum penghalusan.
      if (typeof self._refineVertices === 'function') {
        self._refineVertices(path);
      }

      if (path.sign === "-") {
        reverse(path);
      }

      smooth(path);

      if (self._params.optCurve) {
        optiCurve(path);
      }
    }
  },

  /**
   * Validates some of parameters
   * @param params
   * @private
   */
  _validateParameters: function(params) {
    if (params && params.turnPolicy && SUPPORTED_TURNPOLICY_VALUES.indexOf(params.turnPolicy) === -1) {
      var goodVals = '\'' + SUPPORTED_TURNPOLICY_VALUES.join('\', \'') + '\'';

      throw new Error('Bad turnPolicy value. Allowed values are: ' + goodVals);
    }

    if (params && params.threshold != null && params.threshold !== Potrace.THRESHOLD_AUTO) {
      if (typeof params.threshold !== 'number' || !utils.between(params.threshold, 0, 255)) {
        throw new Error('Bad threshold value. Expected to be an integer in range 0..255');
      }
    }

    if (params && params.optCurve != null && typeof params.optCurve !== 'boolean') {
      throw new Error('\'optCurve\' must be Boolean');
    }
  },

  _processLoadedImage: function(image) {
    var bitmap = new Bitmap(image.bitmap.width, image.bitmap.height);
    var pixels = image.bitmap.data;

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
      // We want background underneath non-opaque regions to be white

      var opacity = pixels[idx + 3] / 255,
          r = 255 + (pixels[idx + 0] - 255) * opacity,
          g = 255 + (pixels[idx + 1] - 255) * opacity,
          b = 255 + (pixels[idx + 2] - 255) * opacity;

      bitmap.data[idx/4] = utils.luminance(r, g, b);
    });

    this._luminanceData = bitmap;
    this._imageLoaded = true;
  },

  /**
   * Reads given image. Uses {@link Jimp} under the hood, so target can be whatever Jimp can take
   *
   * @param {string|Buffer|Jimp} target Image source. Could be anything that {@link Jimp} can read (buffer, local path or url). Supported formats are: PNG, JPEG or BMP
   * @param {Function} callback
   */
  loadImage: function(target, callback) {
    var self = this;
    var jobId = {};

    this._imageLoadingIdentifier = jobId;
    this._imageLoaded = false;

    if (target instanceof Jimp) {
      this._imageLoadingIdentifier = null;
      this._imageLoaded = true;
      self._processLoadedImage(target);
      callback.call(self, null);
    } else {
      Jimp.read(target, function(err, img) {
        var sourceChanged = self._imageLoadingIdentifier !== jobId;

        if (sourceChanged) {
          var error = err ? err : new Error('Another image was loaded instead');
          return callback.call(self, error);
        }

        self._imageLoadingIdentifier = null;
        self._processLoadedImage(img);
        callback.call(self, null);
      });
    }
  },

  /**
   * Sets algorithm parameters
   * @param {Potrace~Options} newParams
   */
  setParameters: function(newParams) {
    var key, tmpOldVal;

    this._validateParameters(newParams);

    for (key in this._params) {
      if (this._params.hasOwnProperty(key) && newParams.hasOwnProperty(key)) {
        tmpOldVal = this._params[key];
        this._params[key] = newParams[key];

        if (tmpOldVal !== this._params[key] && ['color', 'background'].indexOf(key) === -1) {
          this._processed = false;
        }
      }
    }
  },

  /**
   * Generates just <path> tag without rest of the SVG file
   *
   * @param {String} [fillColor] - overrides color from parameters
   * @returns {String}
   */
  getPathTag: function(fillColor, scale) {
    fillColor = arguments.length === 0 ? this._params.color : fillColor;

    if (fillColor === Potrace.COLOR_AUTO) {
      fillColor = this._params.blackOnWhite ? 'black' : 'white';
    }

    if (!this._imageLoaded) {
      throw new Error('Image should be loaded first');
    }

    if (!this._processed) {
      this._bmToPathlist();
      this._processPath();
      this._processed = true;
    }

    var tag = '<path d="';

    tag += this._pathlist.map(function(path) {
      return utils.renderCurve(path.curve, scale);
    }).join(' ');

    tag += '" stroke="none" fill="' + fillColor + '" fill-rule="evenodd"/>';

    return tag;
  },

  /**
   * Returns <symbol> tag. Always has viewBox specified and comes with no fill color,
   * so it could be changed with <use> tag
   *
   * @param id
   * @returns {string}
   */
  getSymbol: function(id) {
    return '<symbol ' +
      'viewBox="0 0 ' + this._luminanceData.width + ' ' + this._luminanceData.height + '" ' +
      'id="' + id + '">' +
      this.getPathTag('') +
      '</symbol>';
  },

  /**
   * Generates SVG image
   * @returns {String}
   */
  getSVG: function() {
    var width = this._params.width || this._luminanceData.width;
    var height = this._params.height || this._luminanceData.height;
    var scale = {
      x: this._params.width ? this._params.width / this._luminanceData.width : 1,
      y: this._params.height ? this._params.height / this._luminanceData.height : 1,
    };

    return '<svg xmlns="http://www.w3.org/2000/svg" ' +
      'width="' + width + '" ' +
      'height="' + height + '" ' +
      'viewBox="0 0 ' + width + ' ' + height + '" ' +
      'version="1.1">\n'+
      (this._params.background !== Potrace.COLOR_TRANSPARENT
        ? '\t<rect x="0" y="0" width="100%" height="100%" fill="' + this._params.background + '" />\n'
        : '') +
      '\t' + this.getPathTag(this._params.color, scale) + '\n' +
      '</svg>';
  }
};

module.exports = Potrace;

/**
 * Potrace options
 *
 * @typedef {Object} Potrace~Options
 * @property {*}       [turnPolicy]   - how to resolve ambiguities in path decomposition (default Potrace.TURNPOLICY_MINORITY)
 * @property {Number}  [turdSize]     - suppress speckles of up to this size (default 2)
 * @property {Number}  [alphaMax]     - corner threshold parameter (default 1)
 * @property {Boolean} [optCurve]     - curve optimization (default true)
 * @property {Number}  [optTolerance] - curve optimization tolerance (default 0.2)
 * @property {Number}  [threshold]    - threshold below which color is considered black (0..255, default Potrace.THRESHOLD_AUTO)
 * @property {Boolean} [blackOnWhite] - specifies colors by which side from threshold should be traced (default true)
 * @property {string}  [color]        - foreground color (default: 'auto' (black or white)) Will be ignored when exporting as <symbol>
 * @property {string}  [background]   - background color (default: 'transparent') Will be ignored when exporting as <symbol>
 */

/**
 * Jimp module
 * @external Jimp
 * @see https://www.npmjs.com/package/jimp
 */
},"types/Bitmap":function(module,exports,require){
'use strict';

var Point = require("types/Point");
var utils = require("utils");
var Histogram;

/**
 * Represents a bitmap where each pixel can be a number in range of 0..255
 * Used internally to store luminance data.
 *
 * @param {Number} w
 * @param {Number} h
 * @constructor
 */
function Bitmap(w, h) {
  this._histogram = null;

  this.width = w;
  this.height = h;
  this.size = w * h;
  this.arrayBuffer = new ArrayBuffer(this.size);
  this.data = new Uint8Array(this.arrayBuffer);
}

module.exports = Bitmap;
Histogram = require("types/Histogram");

Bitmap.prototype = {
  /**
   * Returns pixel value
   *
   * @param {Number|Point} x - index, point or x
   * @param {Number} [y]
   */
  getValueAt: function(x, y) {
    var index = (typeof x === 'number' && typeof y !== 'number') ? x : this.pointToIndex(x, y);
    return this.data[index];
  },

  /**
   * Converts {@link Point} to index value
   *
   * @param {Number} index
   * @returns {Point}
   */
  indexToPoint: function(index) {
    var point = new Point();

	  if (utils.between(index, 0, this.size)) {
      point.y = Math.floor(index / this.width);
      point.x = index - point.y * this.width;
    } else {
      point.x = -1;
      point.y = -1;
    }

    return point;
  },

  /**
   * Calculates index for point or coordinate pair
   *
   * @param {Number|Point} pointOrX
   * @param {Number} [y]
   * @returns {Number}
   */
  pointToIndex: function(pointOrX, y) {
    var _x = pointOrX,
        _y = y;

    if (pointOrX instanceof Point) {
      _x = pointOrX.x;
      _y = pointOrX.y;
    }

    if (!utils.between(_x, 0, this.width) || !utils.between(_y, 0, this.height)) {
      return -1;
    }

    return this.width * _y + _x;
  },

  /**
   * Makes a copy of current bitmap
   *
   * @param {Function} [iterator] optional callback, used for processing pixel value. Accepted arguments: value, index
   * @returns {Bitmap}
   */
  copy: function(iterator) {
    var bm = new Bitmap(this.width, this.height),
        iteratorPresent = typeof iterator === 'function',
        i;

    for (i = 0; i < this.size; i++) {
      bm.data[i] = iteratorPresent ? iterator(this.data[i], i) : this.data[i];
    }

    return bm;
  },

  histogram: function() {
    var Histogram = require("types/Histogram");

    if (this._histogram) {
      return this._histogram;
    }

    this._histogram = new Histogram(this);
    return this._histogram;
  }
};
},"types/Point":function(module,exports,require){
'use strict';

function Point(x, y) {
  this.x = x || 0;
  this.y = y || 0;
}

Point.prototype = {
  copy: function() {
    return new Point(this.x, this.y);
  }
};

module.exports = Point;
},"utils":function(module,exports,require){
'use strict';

var Point = require("types/Point");
var attrRegexps = {};

function getAttrRegexp(attrName) {
  if (attrRegexps[attrName]) {
    return attrRegexps[attrName];
  }

  attrRegexps[attrName] = new RegExp(' ' + attrName + '="((?:\\\\(?=")"|[^"])+)"', 'i');
  return attrRegexps[attrName];
}

function setHtmlAttribute(html, attrName, value) {
  var attr = ' ' + attrName + '="' + value + '"';

  if (html.indexOf(' ' + attrName + '="') === -1) {
    html = html.replace(/<[a-z]+/i, function(beginning) { return beginning + attr; });
  } else {
    html = html.replace(getAttrRegexp(attrName), attr);
  }

  return html;
}

function fixed(number) {
  return number.toFixed(3).replace('.000', '');
}

function mod(a, n) {
  return a >= n ? a % n : a>=0 ? a : n-1-(-1-a) % n;
}

function xprod(p1, p2) {
  return p1.x * p2.y - p1.y * p2.x;
}

function cyclic(a, b, c) {
  if (a <= c) {
    return (a <= b && b < c);
  } else {
    return (a <= b || b < c);
  }
}

function sign(i) {
  return i > 0 ? 1 : i < 0 ? -1 : 0;
}

function quadform(Q, w) {
  var v = new Array(3), i, j, sum;

  v[0] = w.x;
  v[1] = w.y;
  v[2] = 1;
  sum = 0.0;

  for (i=0; i<3; i++) {
    for (j=0; j<3; j++) {
      sum += v[i] * Q.at(i, j) * v[j];
    }
  }
  return sum;
}

function interval(lambda, a, b) {
  var res = new Point();

  res.x = a.x + lambda * (b.x - a.x);
  res.y = a.y + lambda * (b.y - a.y);
  return res;
}

function dorth_infty(p0, p2) {
  var r = new Point();

  r.y = sign(p2.x - p0.x);
  r.x = -sign(p2.y - p0.y);

  return r;
}

function ddenom(p0, p2) {
  var r = dorth_infty(p0, p2);

  return r.y * (p2.x - p0.x) - r.x * (p2.y - p0.y);
}

function dpara(p0, p1, p2) {
  var x1, y1, x2, y2;

  x1 = p1.x - p0.x;
  y1 = p1.y - p0.y;
  x2 = p2.x - p0.x;
  y2 = p2.y - p0.y;

  return x1 * y2 - x2 * y1;
}

function cprod(p0, p1, p2, p3) {
  var x1, y1, x2, y2;

  x1 = p1.x - p0.x;
  y1 = p1.y - p0.y;
  x2 = p3.x - p2.x;
  y2 = p3.y - p2.y;

  return x1 * y2 - x2 * y1;
}

function iprod(p0, p1, p2) {
  var x1, y1, x2, y2;

  x1 = p1.x - p0.x;
  y1 = p1.y - p0.y;
  x2 = p2.x - p0.x;
  y2 = p2.y - p0.y;

  return x1*x2 + y1*y2;
}

function iprod1(p0, p1, p2, p3) {
  var x1, y1, x2, y2;

  x1 = p1.x - p0.x;
  y1 = p1.y - p0.y;
  x2 = p3.x - p2.x;
  y2 = p3.y - p2.y;

  return x1 * x2 + y1 * y2;
}

function ddist(p, q) {
  return Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y));
}

module.exports = {
  luminance: function (r, g, b) {
    return Math.round(0.2126 * r + 0.7153 * g + 0.0721 * b);
  },

  between: function(val, min, max) {
    return val >= min && val <= max;
  },

  clamp: function(val, min, max) {
    return Math.min(max, Math.max(min, val));
  },
  
  isNumber: function(val) {
    return typeof val === 'number';
  },

  setHtmlAttr: setHtmlAttribute,

  /**
   * Generates path instructions for given curve
   *
   * @param {Curve} curve
   * @param {Number} [scale]
   * @returns {string}
   */
  renderCurve: function(curve, scale) {
    scale = scale || { x: 1, y: 1 };

    var startingPoint = curve.c[(curve.n - 1) * 3 + 2];

    var path = [
      'M '
      + fixed(startingPoint.x * scale.x) + ' '
      + fixed(startingPoint.y * scale.y)
    ];

    curve.tag.forEach(function(tag, i) {
      var i3 = i * 3;
      var p0 = curve.c[i3];
      var p1 = curve.c[i3 + 1];
      var p2 = curve.c[i3 + 2];

      if (tag === "CURVE") {
        path.push(
          'C '
          + fixed(p0.x * scale.x) + ' ' + fixed(p0.y * scale.y) + ', '
          + fixed(p1.x * scale.x) + ' ' + fixed(p1.y * scale.y) + ', '
          + fixed(p2.x * scale.x) + ' ' + fixed(p2.y * scale.y)
        );
      } else if (tag === "CORNER") {
        path.push(
          'L '
          + fixed(p1.x * scale.x) + ' ' + fixed(p1.y * scale.y) + ' '
          + fixed(p2.x * scale.x) + ' ' + fixed(p2.y * scale.y)
        );
      }
    });

    return path.join(' ');
  },
  
  bezier: function bezier(t, p0, p1, p2, p3) {
    var s = 1 - t, res = new Point();

    res.x = s*s*s*p0.x + 3*(s*s*t)*p1.x + 3*(t*t*s)*p2.x + t*t*t*p3.x;
    res.y = s*s*s*p0.y + 3*(s*s*t)*p1.y + 3*(t*t*s)*p2.y + t*t*t*p3.y;

    return res;
  },

  tangent: function tangent(p0, p1, p2, p3, q0, q1) {
    var A, B, C, a, b, c, d, s, r1, r2;

    A = cprod(p0, p1, q0, q1);
    B = cprod(p1, p2, q0, q1);
    C = cprod(p2, p3, q0, q1);

    a = A - 2 * B + C;
    b = -2 * A + 2 * B;
    c = A;

    d = b * b - 4 * a * c;

    if (a===0 || d<0) {
      return -1.0;
    }

    s = Math.sqrt(d);

    r1 = (-b + s) / (2 * a);
    r2 = (-b - s) / (2 * a);

    if (r1 >= 0 && r1 <= 1) {
      return r1;
    } else if (r2 >= 0 && r2 <= 1) {
      return r2;
    } else {
      return -1.0;
    }
  },

  mod: mod,
  xprod: xprod,
  cyclic: cyclic,
  sign: sign,
  quadform: quadform,
  interval: interval,
  dorth_infty: dorth_infty,
  ddenom: ddenom,
  dpara: dpara,
  cprod: cprod,
  iprod: iprod,
  iprod1: iprod1,
  ddist: ddist
};
},"types/Histogram":function(module,exports,require){
"use strict";

// Histogram

var utils = require("utils");
var Jimp = null; try { Jimp = function JimpUnavailable() { throw new Error("Use raw pixel adapter"); }; } catch(e) {}
var Bitmap = require("types/Bitmap");

var COLOR_DEPTH = 256;
var COLOR_RANGE_END = COLOR_DEPTH - 1;

/**
 * Calculates array index for pair of indexes. We multiple column (x) by 256 and then add row to it,
 * this way `(index(i, j) + 1) === index(i, j + i)` thus we can reuse `index(i, j)` we once calculated
 *
 * Note: this is different from how indexes calculated in {@link Bitmap} class, keep it in mind.
 *
 * @param x
 * @param y
 * @returns {*}
 * @private
 */
function index(x, y) {
  return COLOR_DEPTH * x + y;
}

function normalizeMinMax(levelMin, levelMax) {
  /**
   * Shared parameter normalization for methods 'multilevelThresholding', 'autoThreshold', 'getDominantColor' and 'getStats'
   *
   * @param levelMin
   * @param levelMax
   * @returns {number[]}
   * @private
   */
  levelMin = typeof levelMin === 'number' ? utils.clamp(Math.round(levelMin), 0, COLOR_RANGE_END) : 0;
  levelMax = typeof levelMax === 'number' ? utils.clamp(Math.round(levelMax), 0, COLOR_RANGE_END) : COLOR_RANGE_END;

  if (levelMin > levelMax) {
    throw new Error('Invalid range "'+ levelMin + '...' + levelMax + '"');
  }

  return [levelMin, levelMax];
}

/**
 * 1D Histogram
 *
 * @param {Number|Bitmap|Jimp} imageSource - Image to collect pixel data from. Or integer to create empty histogram for image of specific size
 * @param [mode] Used only for Jimp images. {@link Bitmap} currently can only store 256 values per pixel, so it's assumed that it contains values we are looking for
 * @constructor
 * @protected
 */
function Histogram(imageSource, mode) {
  this.data = null;
  this.pixels = 0;
  this._sortedIndexes = null;
  this._cachedStats = {};
  this._lookupTableH = null;

  if (typeof imageSource === 'number') {
    this._createArray(imageSource);
  } else if (imageSource instanceof Bitmap) {
    this._collectValuesBitmap(imageSource);
  } else if (Jimp && imageSource instanceof Jimp) {
    this._collectValuesJimp(imageSource, mode);
  } else {
    throw new Error('Unsupported image source');
  }
}

Histogram.MODE_LUMINANCE = 'luminance';
Histogram.MODE_R = 'r';
Histogram.MODE_G = 'g';
Histogram.MODE_B = 'b';

Histogram.prototype = {
  /**
   * Initializes data array for an image of given pixel size
   * @param imageSize
   * @returns {Uint8Array|Uint16Array|Uint32Array}
   * @private
   */
  _createArray: function(imageSize) {
    var ArrayType = imageSize <= Math.pow(2, 8) ? Uint8Array
      : imageSize <= Math.pow(2, 16) ? Uint16Array : Uint32Array;

    this.pixels = imageSize;
    
    return this.data = new ArrayType(COLOR_DEPTH);
  },

  /**
   * Aggregates color data from {@link Jimp} instance
   * @param {Jimp} source
   * @param mode
   * @private
   */
  _collectValuesJimp: function(source, mode) {
    var pixelData = source.bitmap.data;
    var data = this._createArray(source.bitmap.width * source.bitmap.height);

    source.scan(0, 0, source.bitmap.width, source.bitmap.height, function(x, y, idx) {
      var val = mode === Histogram.MODE_R ? pixelData[idx]
        : mode === Histogram.MODE_G ? pixelData[idx + 1]
        : mode === Histogram.MODE_B ? pixelData[idx + 2]
        : utils.luminance(pixelData[idx], pixelData[idx + 1], pixelData[idx + 2]);

      data[val]++;
    });
  },

  /**
   * Aggregates color data from {@link Bitmap} instance
   * @param {Bitmap} source
   * @private
   */
  _collectValuesBitmap: function(source) {
    var data = this._createArray(source.size);
    var len = source.data.length;
    var color;

    for (var i = 0; i < len; i++) {
      color = source.data[i];
      data[color]++
    }
  },

  /**
   * Returns array of color indexes in ascending order
   * @param refresh
   * @returns {*}
   * @private
   */
  _getSortedIndexes: function(refresh) {
    if (!refresh && this._sortedIndexes) {
      return this._sortedIndexes;
    }

    var data = this.data;
    var indexes = new Array(COLOR_DEPTH);
    var i = 0;

    for (i; i < COLOR_DEPTH; i++) {
      indexes[i] = i;
    }

    indexes.sort(function(a, b) {
      return data[a] > data[b] ? 1 : data[a] < data[b] ? -1 : 0;
    });

    this._sortedIndexes = indexes;
    return indexes;
  },

  /**
   * Builds lookup table H from lookup tables P and S.
   * see {@link http://www.iis.sinica.edu.tw/page/jise/2001/200109_01.pdf|this paper} for more details
   *
   * @returns {Float64Array}
   * @private
   */
  _thresholdingBuildLookupTable: function() {
    var P = new Float64Array(COLOR_DEPTH * COLOR_DEPTH);
    var S = new Float64Array(COLOR_DEPTH * COLOR_DEPTH);
    var H = new Float64Array(COLOR_DEPTH * COLOR_DEPTH);
    var pixelsTotal = this.pixels;
    var i, j, idx, tmp;

    // diagonal
    for (i = 1; i < COLOR_DEPTH; ++i) {
      idx = index(i, i);
      tmp = this.data[i] / pixelsTotal;

      P[idx] = tmp;
      S[idx] = i * tmp;
    }

    // calculate first row (row 0 is all zero)
    for (i = 1; i < COLOR_DEPTH - 1; ++i) {
      tmp = this.data[i + 1] / pixelsTotal;
      idx = index(1, i);

      P[idx+1] = P[idx] + tmp;
      S[idx+1] = S[idx] + (i + 1) * tmp;
    }

    // using row 1 to calculate others
    for (i = 2; i < COLOR_DEPTH; i++) {
      for (j=i+1; j < COLOR_DEPTH; j++) {
        P[index(i, j)] = P[index(1, j)] - P[index(1, i-1)];
        S[index(i, j)] = S[index(1, j)] - S[index(1, i-1)];
      }
    }

    // now calculate H[i][j]
    for (i = 1; i < COLOR_DEPTH; ++i) {
      for (j = i + 1; j < COLOR_DEPTH; j++) {
        idx = index(i, j);
        H[idx] = P[idx] !== 0 ? S[idx] * S[idx] / P[idx] : 0;
      }
    }
    
    return this._lookupTableH = H;
  },

  /**
   * Implements Algorithm For Multilevel Thresholding
   * Receives desired number of color stops, returns array of said size. Could be limited to a range levelMin..levelMax
   *
   * Regardless of levelMin and levelMax values it still relies on between class variances for the entire histogram
   *
   * @param amount - how many thresholds should be calculated
   * @param [levelMin=0] - histogram segment start
   * @param [levelMax=255] - histogram segment end
   * @returns {number[]}
	 */
  multilevelThresholding: function (amount, levelMin, levelMax) {
    levelMin = normalizeMinMax(levelMin, levelMax);
    levelMax = levelMin[1];
    levelMin = levelMin[0];
    amount = Math.min(levelMax - levelMin - 2, ~~amount);

    if (amount < 1) {
      return [];
    }

    if (!this._lookupTableH) {
      this._thresholdingBuildLookupTable();
    }

    var H = this._lookupTableH;
    
    var colorStops = null;
    var maxSig = 0;

    if (amount > 4) {
      console.log('[Warning]: Threshold computation for more than 5 levels may take a long time');
    }

    function iterateRecursive (startingPoint, prevVariance, indexes, previousDepth) {
      startingPoint = (startingPoint || 0) + 1;
      prevVariance = prevVariance || 0;
      indexes = indexes || (new Array(amount));
      previousDepth = previousDepth || 0;

      var depth = previousDepth + 1; // t
      var variance;

      for (var i = startingPoint; i < levelMax - amount + previousDepth; i++) {
        variance = prevVariance + H[index(startingPoint, i)];
        indexes[depth - 1] = i;

	      if (depth + 1 < amount + 1) {
          // we need to go deeper
          iterateRecursive(i, variance, indexes, depth);
        } else {
          // enough, we can compare values now
          variance += H[index(i + 1, levelMax)];

          if (maxSig < variance) {
            maxSig = variance;
            colorStops = indexes.slice();
          }
        }
      }
    }

    iterateRecursive(levelMin || 0);

    return colorStops ? colorStops : [];
  },

  /**
   * Automatically finds threshold value using Algorithm For Multilevel Thresholding
   *
   * @param {number} [levelMin]
   * @param {number} [levelMax]
   * @returns {null|number}
   */
  autoThreshold: function(levelMin, levelMax) {
    var value = this.multilevelThresholding(1, levelMin, levelMax);
    return value.length ? value[0] : null;
  },

  /**
   * Returns dominant color in given range. Returns -1 if not a single color from the range present on the image
   *
   * @param [levelMin=0]
   * @param [levelMax=255]
   * @param [tolerance=1]
   * @returns {number}
   */
  getDominantColor: function(levelMin, levelMax, tolerance) {
    levelMin = normalizeMinMax(levelMin, levelMax);
    levelMax = levelMin[1];
    levelMin = levelMin[0];
    tolerance = tolerance || 1;

    var colors = this.data,
        dominantIndex = -1,
        dominantValue = -1,
        i, j, tmp;

    if (levelMin === levelMax) {
      return colors[levelMin] ? levelMin : -1;
    }

    for (i=levelMin; i <= levelMax; i++) {
      tmp = 0;

      for (j = ~~(tolerance / -2); j < tolerance; j++) {
        tmp += utils.between(i + j, 0, COLOR_RANGE_END) ? colors[i + j] : 0;
      }

      var summIsBigger = tmp > dominantValue;
      var summEqualButMainColorIsBigger = dominantValue === tmp && (dominantIndex < 0 || colors[i] > colors[dominantIndex]);

      if (summIsBigger || summEqualButMainColorIsBigger) {
        dominantIndex = i;
        dominantValue = tmp;
      }
    }

    return dominantValue <= 0 ? -1 : dominantIndex;
  },

  /**
   * Returns stats for histogram or its segment.
   *
   * Returned object contains median, mean and standard deviation for pixel values;
   * peak, mean and median number of pixels per level and few other values
   *
   * If no pixels colors from specified range present on the image - most values will be NaN
   *
   * @param {Number} [levelMin=0] - histogram segment start
   * @param {Number} [levelMax=255] - histogram segment end
   * @param {Boolean} [refresh=false] - if cached result can be returned
   * @returns {{levels: {mean: (number|*), median: *, stdDev: number, unique: number}, pixelsPerLevel: {mean: (number|*), median: (number|*), peak: number}, pixels: number}}
   */
  getStats: function(levelMin, levelMax, refresh) {
    levelMin = normalizeMinMax(levelMin, levelMax);
    levelMax = levelMin[1];
    levelMin = levelMin[0];

    if (!refresh && this._cachedStats[levelMin + '-' + levelMax]) {
      return this._cachedStats[levelMin + '-' + levelMax];
    }

    var data = this.data;
    var sortedIndexes = this._getSortedIndexes();

    var pixelsTotal = 0;
    var medianValue = null;
    var meanValue;
    var medianPixelIndex;
    var pixelsPerLevelMean;
    var pixelsPerLevelMedian;
    var tmpSumOfDeviations = 0;
    var tmpPixelsIterated = 0;
    var allPixelValuesCombined = 0;
    var i, tmpPixels, tmpPixelValue;

    var uniqueValues = 0; // counter for levels that's represented by at least one pixel
    var mostPixelsPerLevel = 0;

    // Finding number of pixels and mean

    for (i = levelMin; i <= levelMax; i++) {
      pixelsTotal += data[i];
      allPixelValuesCombined += data[i] * i;

      uniqueValues += data[i] === 0 ? 0 : 1;

      if (mostPixelsPerLevel < data[i]) {
        mostPixelsPerLevel = data[i];
      }
    }

    meanValue = allPixelValuesCombined / pixelsTotal;
    pixelsPerLevelMean = pixelsTotal / (levelMax - levelMin);
    pixelsPerLevelMedian = pixelsTotal / uniqueValues;
    medianPixelIndex = Math.floor(pixelsTotal / 2);

    // Finding median and standard deviation

    for (i = 0; i < COLOR_DEPTH; i++) {
      tmpPixelValue = sortedIndexes[i];
      tmpPixels = data[tmpPixelValue];

      if (tmpPixelValue < levelMin || tmpPixelValue > levelMax) {
        continue;
      }

      tmpPixelsIterated += tmpPixels;
      tmpSumOfDeviations += Math.pow(tmpPixelValue - meanValue, 2) * tmpPixels;

      if (medianValue === null && tmpPixelsIterated >= medianPixelIndex) {
        medianValue = tmpPixelValue;
      }
    }

    return this._cachedStats[levelMin + '-' + levelMax] = {
      // various pixel counts for levels (0..255)

      levels: {
        mean: meanValue,
        median: medianValue,
        stdDev: Math.sqrt(tmpSumOfDeviations / pixelsTotal),
        unique: uniqueValues
      },

      // what's visually represented as bars
      pixelsPerLevel: {
        mean: pixelsPerLevelMean,
        median: pixelsPerLevelMedian,
        peak: mostPixelsPerLevel
      },

      pixels: pixelsTotal
    };
  }
};

module.exports = Histogram;
},"types/Curve":function(module,exports,require){
'use strict';

/**
 * Curve type
 *
 * @param n
 * @constructor
 * @protected
 */
function Curve(n) {
  this.n = n;
  this.tag = new Array(n);
  this.c = new Array(n * 3);
  this.alphaCurve = 0;
  this.vertex = new Array(n);
  this.alpha = new Array(n);
  this.alpha0 = new Array(n);
  this.beta = new Array(n);
}

module.exports = Curve;
},"types/Path":function(module,exports,require){
'use strict';

function Path() {
  this.area = 0;
  this.len = 0;
  this.curve = {};
  this.pt = [];
  this.minX = 100000;
  this.minY = 100000;
  this.maxX = -1;
  this.maxY = -1;
}

module.exports = Path;
},"types/Quad":function(module,exports,require){
'use strict';

function Quad() {
  this.data = [0,0,0,0,0,0,0,0,0];
}

Quad.prototype.at = function(x, y) {
  return this.data[x * 3 + y];
};

module.exports = Quad;
},"types/Sum":function(module,exports,require){
'use strict';

function Sum(x, y, xy, x2, y2) {
  this.x = x;
  this.y = y;
  this.xy = xy;
  this.x2 = x2;
  this.y2 = y2;
}

module.exports = Sum;
},"types/Opti":function(module,exports,require){
'use strict';

var Point = require("types/Point");

function Opti() {
  this.pen = 0;
  this.c = [new Point(), new Point()];
  this.t = 0;
  this.s = 0;
  this.alpha = 0;
}

module.exports = Opti;
}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports}return {Potrace:require("Potrace"),Bitmap:require("types/Bitmap")};})();

/*
	imagetracer.js version 1.2.6
	Simple raster image tracer and vectorizer written in JavaScript.
	andras@jankovics.net
*/

/*

The Unlicense / PUBLIC DOMAIN

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to http://unlicense.org/

*/

(function(){ 'use strict';

function ImageTracer(){
	var _this = this;

	this.versionnumber = '1.2.6',
	
	////////////////////////////////////////////////////////////
	//
	//  API
	//
	////////////////////////////////////////////////////////////
	
	// Loading an image from a URL, tracing when loaded,
	// then executing callback with the scaled svg string as argument
	this.imageToSVG = function( url, callback, options ){
		options = _this.checkoptions(options);
		// loading image, tracing and callback
		_this.loadImage(
			url,
			function(canvas){
				callback(
					_this.imagedataToSVG( _this.getImgdata(canvas), options )
				);
			},
			options
		);
	},// End of imageToSVG()
	
	// Tracing imagedata, then returning the scaled svg string
	this.imagedataToSVG = function( imgd, options ){
		options = _this.checkoptions(options);
		// tracing imagedata
		var td = _this.imagedataToTracedata( imgd, options );
		// returning SVG string
		return _this.getsvgstring(td, options);
	},// End of imagedataToSVG()
	
	// Loading an image from a URL, tracing when loaded,
	// then executing callback with tracedata as argument
	this.imageToTracedata = function( url, callback, options ){
		options = _this.checkoptions(options);
		// loading image, tracing and callback
		_this.loadImage(
				url,
				function(canvas){
					callback(
						_this.imagedataToTracedata( _this.getImgdata(canvas), options )
					);
				},
				options
		);
	},// End of imageToTracedata()
	
	// Tracing imagedata, then returning tracedata (layers with paths, palette, image size)
	this.imagedataToTracedata = function( imgd, options ){
		options = _this.checkoptions(options);
		
		// 1. Color quantization
		var ii = _this.colorquantization( imgd, options );
		
		if(options.layering === 0){// Sequential layering
			
			// create tracedata object
			var tracedata = {
				layers : [],
				palette : ii.palette,
				width : ii.array[0].length-2,
				height : ii.array.length-2
			};
			
			// Loop to trace each color layer
			for(var colornum=0; colornum<ii.palette.length; colornum++){
				
				// layeringstep -> pathscan -> internodes -> batchtracepaths
				var tracedlayer =
					_this.batchtracepaths(
							
						_this.internodes(
								
							_this.pathscan(
								_this.layeringstep( ii, colornum ),
								options.pathomit
							),
							
							options
							
						),
						
						options.ltres,
						options.qtres
						
					);
				
				// adding traced layer
				tracedata.layers.push(tracedlayer);
				
			}// End of color loop
			
		}else{// Parallel layering
			// 2. Layer separation and edge detection
			var ls = _this.layering( ii );
			
			// Optional edge node visualization
			if(options.layercontainerid){ _this.drawLayers( ls, _this.specpalette, options.scale, options.layercontainerid ); }
			
			// 3. Batch pathscan
			var bps = _this.batchpathscan( ls, options.pathomit );
			
			// 4. Batch interpollation
			var bis = _this.batchinternodes( bps, options );
			
			// 5. Batch tracing and creating tracedata object
			var tracedata = {
				layers : _this.batchtracelayers( bis, options.ltres, options.qtres ),
				palette : ii.palette,
				width : imgd.width,
				height : imgd.height
			};
			
		}// End of parallel layering
		
		// return tracedata
		return tracedata;
		
	},// End of imagedataToTracedata()
	
	this.optionpresets = {
		'default': {
			
			// Tracing
			corsenabled : false,
			ltres : 1,
			qtres : 1,
			pathomit : 8,
			rightangleenhance : true,
			
			// Color quantization
			colorsampling : 2,
			numberofcolors : 16,
			mincolorratio : 0,
			colorquantcycles : 3,
			
			// Layering method
			layering : 0,
			
			// SVG rendering
			strokewidth : 1,
			linefilter : false,
			scale : 1,
			roundcoords : 1,
			viewbox : false,
			desc : false,
			lcpr : 0,
			qcpr : 0,
			
			// Blur
			blurradius : 0,
			blurdelta : 20
			
		},
		'posterized1': { colorsampling:0, numberofcolors:2 },
		'posterized2': { numberofcolors:4, blurradius:5 },
		'curvy': { ltres:0.01, linefilter:true, rightangleenhance:false },
		'sharp': { qtres:0.01, linefilter:false },
		'detailed': { pathomit:0, roundcoords:2, ltres:0.5, qtres:0.5, numberofcolors:64 },
		'smoothed': { blurradius:5, blurdelta: 64 },
		'grayscale': { colorsampling:0, colorquantcycles:1, numberofcolors:7 },
		'fixedpalette': { colorsampling:0, colorquantcycles:1, numberofcolors:27 },
		'randomsampling1': { colorsampling:1, numberofcolors:8 },
		'randomsampling2': { colorsampling:1, numberofcolors:64 },
		'artistic1': { colorsampling:0, colorquantcycles:1, pathomit:0, blurradius:5, blurdelta: 64, ltres:0.01, linefilter:true, numberofcolors:16, strokewidth:2 },
		'artistic2': { qtres:0.01, colorsampling:0, colorquantcycles:1, numberofcolors:4, strokewidth:0 },
		'artistic3': { qtres:10, ltres:10, numberofcolors:8 },
		'artistic4': { qtres:10, ltres:10, numberofcolors:64, blurradius:5, blurdelta: 256, strokewidth:2 },
		'posterized3': { ltres: 1, qtres: 1, pathomit: 20, rightangleenhance: true, colorsampling: 0, numberofcolors: 3,
			mincolorratio: 0, colorquantcycles: 3, blurradius: 3, blurdelta: 20, strokewidth: 0, linefilter: false,
			roundcoords: 1, pal: [ { r: 0, g: 0, b: 100, a: 255 }, { r: 255, g: 255, b: 255, a: 255 } ] }
	},// End of optionpresets
	
	// creating options object, setting defaults for missing values
	this.checkoptions = function(options){
		options = options || {};
		// Option preset
		if(typeof options === 'string'){
			options = options.toLowerCase();
			if( _this.optionpresets[options] ){ options = _this.optionpresets[options]; }else{ options = {}; }
		}
		// Defaults
		var ok = Object.keys(_this.optionpresets['default']);
		for(var k=0; k<ok.length; k++){
			if(!options.hasOwnProperty(ok[k])){ options[ok[k]] = _this.optionpresets['default'][ok[k]]; }
		}
		// options.pal is not defined here, the custom palette should be added externally: options.pal = [ { 'r':0, 'g':0, 'b':0, 'a':255 }, {...}, ... ];
		// options.layercontainerid is not defined here, can be added externally: options.layercontainerid = 'mydiv'; ... <div id="mydiv"></div>
		return options;
	},// End of checkoptions()
	
	////////////////////////////////////////////////////////////
	//
	//  Vectorizing functions
	//
	////////////////////////////////////////////////////////////
	
	// 1. Color quantization
	// Using a form of k-means clustering repeatead options.colorquantcycles times. http://en.wikipedia.org/wiki/Color_quantization
	this.colorquantization = function( imgd, options ){
		var arr = [], idx=0, cd,cdl,ci, paletteacc = [], pixelnum = imgd.width * imgd.height, i, j, k, cnt, palette;
		
		// imgd.data must be RGBA, not just RGB
		if( imgd.data.length < pixelnum * 4 ){
			var newimgddata = new Uint8ClampedArray(pixelnum * 4);
			for(var pxcnt = 0; pxcnt < pixelnum ; pxcnt++){
				newimgddata[pxcnt*4  ] = imgd.data[pxcnt*3  ];
				newimgddata[pxcnt*4+1] = imgd.data[pxcnt*3+1];
				newimgddata[pxcnt*4+2] = imgd.data[pxcnt*3+2];
				newimgddata[pxcnt*4+3] = 255;
			}
			imgd.data = newimgddata;
		}// End of RGBA imgd.data check
		
		// Filling arr (color index array) with -1
		for( j=0; j<imgd.height+2; j++ ){ arr[j]=[]; for(i=0; i<imgd.width+2 ; i++){ arr[j][i] = -1; } }
		
		// Use custom palette if pal is defined or sample / generate custom length palette
		if(options.pal){
			palette = options.pal;
		}else if(options.colorsampling === 0){
			palette = _this.generatepalette(options.numberofcolors);
		}else if(options.colorsampling === 1){
			palette = _this.samplepalette( options.numberofcolors, imgd );
		}else{
			palette = _this.samplepalette2( options.numberofcolors, imgd );
		}
		
		// Selective Gaussian blur preprocessing
		if( options.blurradius > 0 ){ imgd = _this.blur( imgd, options.blurradius, options.blurdelta ); }
		
		// Repeat clustering step options.colorquantcycles times
		for( cnt=0; cnt < options.colorquantcycles; cnt++ ){
			
			// Average colors from the second iteration
			if(cnt>0){
				// averaging paletteacc for palette
				for( k=0; k < palette.length; k++ ){
					
					// averaging
					if( paletteacc[k].n > 0 ){
						palette[k] = {  r: Math.floor( paletteacc[k].r / paletteacc[k].n ),
										g: Math.floor( paletteacc[k].g / paletteacc[k].n ),
										b: Math.floor( paletteacc[k].b / paletteacc[k].n ),
										a:  Math.floor( paletteacc[k].a / paletteacc[k].n ) };
					}
					
					// Randomizing a color, if there are too few pixels and there will be a new cycle
					if( ( paletteacc[k].n/pixelnum < options.mincolorratio ) && ( cnt < options.colorquantcycles-1 ) ){
						palette[k] = {  r: Math.floor(Math.random()*255),
										g: Math.floor(Math.random()*255),
										b: Math.floor(Math.random()*255),
										a: Math.floor(Math.random()*255) };
					}
					
				}// End of palette loop
			}// End of Average colors from the second iteration
			
			// Reseting palette accumulator for averaging
			for( i=0; i < palette.length; i++ ){ paletteacc[i] = { r:0, g:0, b:0, a:0, n:0 }; }
			
			// loop through all pixels
			for( j=0; j < imgd.height; j++ ){
				for( i=0; i < imgd.width; i++ ){
					
					// pixel index
					idx = (j*imgd.width+i)*4;
					
					// find closest color from palette by measuring (rectilinear) color distance between this pixel and all palette colors
					ci=0; cdl = 1024; // 4 * 256 is the maximum RGBA distance
					for( k=0; k<palette.length; k++ ){
						
						// In my experience, https://en.wikipedia.org/wiki/Rectilinear_distance works better than https://en.wikipedia.org/wiki/Euclidean_distance
						cd = 
							( palette[k].r > imgd.data[idx  ] ? palette[k].r - imgd.data[idx  ] : imgd.data[idx  ] - palette[k].r ) +
							( palette[k].g > imgd.data[idx+1] ? palette[k].g - imgd.data[idx+1] : imgd.data[idx+1] - palette[k].g ) +
							( palette[k].b > imgd.data[idx+2] ? palette[k].b - imgd.data[idx+2] : imgd.data[idx+2] - palette[k].b ) +
							( palette[k].a > imgd.data[idx+3] ? palette[k].a - imgd.data[idx+3] : imgd.data[idx+3] - palette[k].a );
						
						// Remember this color if this is the closest yet
						if(cd<cdl){ cdl = cd; ci = k; }
						
					}// End of palette loop
					
					// add to palettacc
					paletteacc[ci].r += imgd.data[idx  ];
					paletteacc[ci].g += imgd.data[idx+1];
					paletteacc[ci].b += imgd.data[idx+2];
					paletteacc[ci].a += imgd.data[idx+3];
					paletteacc[ci].n++;
					
					// update the indexed color array
					arr[j+1][i+1] = ci;
					
				}// End of i loop
			}// End of j loop
			
		}// End of Repeat clustering step options.colorquantcycles times
		
		return { array:arr, palette:palette };
		
	},// End of colorquantization()
	
	// Sampling a palette from imagedata
	this.samplepalette = function( numberofcolors, imgd ){
		var idx, palette=[];
		for(var i=0; i<numberofcolors; i++){
			idx = Math.floor( Math.random() * imgd.data.length / 4 ) * 4;
			palette.push({ r:imgd.data[idx  ], g:imgd.data[idx+1], b:imgd.data[idx+2], a:imgd.data[idx+3] });
		}
		return palette;
	},// End of samplepalette()
	
	// Deterministic sampling a palette from imagedata: rectangular grid
	this.samplepalette2 = function( numberofcolors, imgd ){
		var idx, palette=[], ni = Math.ceil(Math.sqrt(numberofcolors)), nj = Math.ceil(numberofcolors/ni),
			vx = imgd.width / (ni+1), vy = imgd.height / (nj+1);
		for(var j=0; j<nj; j++){
			for(var i=0; i<ni; i++){
				if(palette.length === numberofcolors){
					break;
				}else{
					idx = Math.floor( ((j+1)*vy) * imgd.width + ((i+1)*vx) ) * 4;
					palette.push( { r:imgd.data[idx], g:imgd.data[idx+1], b:imgd.data[idx+2], a:imgd.data[idx+3] } );
				}
			}
		}
		return palette;
	},// End of samplepalette2()
	
	// Generating a palette with numberofcolors
	this.generatepalette = function(numberofcolors){
		var palette = [], rcnt, gcnt, bcnt;
		if(numberofcolors<8){
			
			// Grayscale
			var graystep = Math.floor(255/(numberofcolors-1));
			for(var i=0; i<numberofcolors; i++){ palette.push({ r:i*graystep, g:i*graystep, b:i*graystep, a:255 }); }
			
		}else{
			
			// RGB color cube
			var colorqnum = Math.floor(Math.pow(numberofcolors, 1/3)), // Number of points on each edge on the RGB color cube
				colorstep = Math.floor(255/(colorqnum-1)), // distance between points
				rndnum = numberofcolors - colorqnum*colorqnum*colorqnum; // number of random colors
			
			for(rcnt=0; rcnt<colorqnum; rcnt++){
				for(gcnt=0; gcnt<colorqnum; gcnt++){
					for(bcnt=0; bcnt<colorqnum; bcnt++){
						palette.push( { r:rcnt*colorstep, g:gcnt*colorstep, b:bcnt*colorstep, a:255 } );
					}// End of blue loop
				}// End of green loop
			}// End of red loop
			
			// Rest is random
			for(rcnt=0; rcnt<rndnum; rcnt++){ palette.push({ r:Math.floor(Math.random()*255), g:Math.floor(Math.random()*255), b:Math.floor(Math.random()*255), a:Math.floor(Math.random()*255) }); }

		}// End of numberofcolors check
		
		return palette;
	},// End of generatepalette()
		
	// 2. Layer separation and edge detection
	// Edge node types ( ▓: this layer or 1; ░: not this layer or 0 )
	// 12  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓
	// 48  ░░  ░░  ░░  ░░  ░▓  ░▓  ░▓  ░▓  ▓░  ▓░  ▓░  ▓░  ▓▓  ▓▓  ▓▓  ▓▓
	//     0   1   2   3   4   5   6   7   8   9   10  11  12  13  14  15
	this.layering = function(ii){
		// Creating layers for each indexed color in arr
		var layers = [], val=0, ah = ii.array.length, aw = ii.array[0].length, n1,n2,n3,n4,n5,n6,n7,n8, i, j, k;
		
		// Create layers
		for(k=0; k<ii.palette.length; k++){
			layers[k] = [];
			for(j=0; j<ah; j++){
				layers[k][j] = [];
				for(i=0; i<aw; i++){
					layers[k][j][i]=0;
				}
			}
		}
		
		// Looping through all pixels and calculating edge node type
		for(j=1; j<ah-1; j++){
			for(i=1; i<aw-1; i++){
				
				// This pixel's indexed color
				val = ii.array[j][i];
				
				// Are neighbor pixel colors the same?
				n1 = ii.array[j-1][i-1]===val ? 1 : 0;
				n2 = ii.array[j-1][i  ]===val ? 1 : 0;
				n3 = ii.array[j-1][i+1]===val ? 1 : 0;
				n4 = ii.array[j  ][i-1]===val ? 1 : 0;
				n5 = ii.array[j  ][i+1]===val ? 1 : 0;
				n6 = ii.array[j+1][i-1]===val ? 1 : 0;
				n7 = ii.array[j+1][i  ]===val ? 1 : 0;
				n8 = ii.array[j+1][i+1]===val ? 1 : 0;
				
				// this pixel's type and looking back on previous pixels
				layers[val][j+1][i+1] = 1 + n5 * 2 + n8 * 4 + n7 * 8 ;
				if(!n4){ layers[val][j+1][i  ] = 0 + 2 + n7 * 4 + n6 * 8 ; }
				if(!n2){ layers[val][j  ][i+1] = 0 + n3*2 + n5 * 4 + 8 ; }
				if(!n1){ layers[val][j  ][i  ] = 0 + n2*2 + 4 + n4 * 8 ; }
				
			}// End of i loop
		}// End of j loop
		
		return layers;
	},// End of layering()
	
	// 2. Layer separation and edge detection
	// Edge node types ( ▓: this layer or 1; ░: not this layer or 0 )
	// 12  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓  ░░  ▓░  ░▓  ▓▓
	// 48  ░░  ░░  ░░  ░░  ░▓  ░▓  ░▓  ░▓  ▓░  ▓░  ▓░  ▓░  ▓▓  ▓▓  ▓▓  ▓▓
	//     0   1   2   3   4   5   6   7   8   9   10  11  12  13  14  15
	this.layeringstep = function(ii,cnum){
		// Creating layers for each indexed color in arr
		var layer = [], val=0, ah = ii.array.length, aw = ii.array[0].length, n1,n2,n3,n4,n5,n6,n7,n8, i, j, k;
		
		// Create layer
		for(j=0; j<ah; j++){
			layer[j] = [];
			for(i=0; i<aw; i++){
				layer[j][i]=0;
			}
		}
		
		// Looping through all pixels and calculating edge node type
		for(j=1; j<ah; j++){
			for(i=1; i<aw; i++){
				layer[j][i] =
					( ii.array[j-1][i-1]===cnum ? 1 : 0 ) +
					( ii.array[j-1][i]===cnum ? 2 : 0 ) +
					( ii.array[j][i-1]===cnum ? 8 : 0 ) +
					( ii.array[j][i]===cnum ? 4 : 0 )
				;
			}// End of i loop
		}// End of j loop
			
		return layer;
	},// End of layeringstep()
	
	// Point in polygon test
	this.pointinpoly = function( p, pa ){
		var isin=false;

		for(var i=0,j=pa.length-1; i<pa.length; j=i++){
			isin =
				( ((pa[i].y > p.y) !== (pa[j].y > p.y)) && (p.x < (pa[j].x - pa[i].x) * (p.y - pa[i].y) / (pa[j].y - pa[i].y) + pa[i].x) )
				? !isin : isin;
		}

		return isin;
	},
	
	// Lookup tables for pathscan
	// pathscan_combined_lookup[ arr[py][px] ][ dir ] = [nextarrpypx, nextdir, deltapx, deltapy];
	this.pathscan_combined_lookup = [
		[[-1,-1,-1,-1], [-1,-1,-1,-1], [-1,-1,-1,-1], [-1,-1,-1,-1]],// arr[py][px]===0 is invalid
		[[ 0, 1, 0,-1], [-1,-1,-1,-1], [-1,-1,-1,-1], [ 0, 2,-1, 0]],
		[[-1,-1,-1,-1], [-1,-1,-1,-1], [ 0, 1, 0,-1], [ 0, 0, 1, 0]],
		[[ 0, 0, 1, 0], [-1,-1,-1,-1], [ 0, 2,-1, 0], [-1,-1,-1,-1]],
		
		[[-1,-1,-1,-1], [ 0, 0, 1, 0], [ 0, 3, 0, 1], [-1,-1,-1,-1]],
		[[13, 3, 0, 1], [13, 2,-1, 0], [ 7, 1, 0,-1], [ 7, 0, 1, 0]],
		[[-1,-1,-1,-1], [ 0, 1, 0,-1], [-1,-1,-1,-1], [ 0, 3, 0, 1]],
		[[ 0, 3, 0, 1], [ 0, 2,-1, 0], [-1,-1,-1,-1], [-1,-1,-1,-1]],
		
		[[ 0, 3, 0, 1], [ 0, 2,-1, 0], [-1,-1,-1,-1], [-1,-1,-1,-1]],
		[[-1,-1,-1,-1], [ 0, 1, 0,-1], [-1,-1,-1,-1], [ 0, 3, 0, 1]],
		[[11, 1, 0,-1], [14, 0, 1, 0], [14, 3, 0, 1], [11, 2,-1, 0]],
		[[-1,-1,-1,-1], [ 0, 0, 1, 0], [ 0, 3, 0, 1], [-1,-1,-1,-1]],
		
		[[ 0, 0, 1, 0], [-1,-1,-1,-1], [ 0, 2,-1, 0], [-1,-1,-1,-1]],
		[[-1,-1,-1,-1], [-1,-1,-1,-1], [ 0, 1, 0,-1], [ 0, 0, 1, 0]],
		[[ 0, 1, 0,-1], [-1,-1,-1,-1], [-1,-1,-1,-1], [ 0, 2,-1, 0]],
		[[-1,-1,-1,-1], [-1,-1,-1,-1], [-1,-1,-1,-1], [-1,-1,-1,-1]]// arr[py][px]===15 is invalid
	],

	// 3. Walking through an edge node array, discarding edge node types 0 and 15 and creating paths from the rest.
	// Walk directions (dir): 0 > ; 1 ^ ; 2 < ; 3 v 
	this.pathscan = function( arr, pathomit ){
		var paths=[], pacnt=0, pcnt=0, px=0, py=0, w = arr[0].length, h = arr.length,
			dir=0, pathfinished=true, holepath=false, lookuprow;
		
		for(var j=0; j<h; j++){
			for(var i=0; i<w; i++){
				if( (arr[j][i] == 4) || ( arr[j][i] == 11) ){ // Other values are not valid
					
					// Init
					px = i; py = j;
					paths[pacnt] = {};
					paths[pacnt].points = [];
					paths[pacnt].boundingbox = [px,py,px,py];
					paths[pacnt].holechildren = [];
					pathfinished = false;
					pcnt=0;
					holepath = (arr[j][i]==11);
					dir = 1;

					// Path points loop
					while(!pathfinished){
						
						// New path point
						paths[pacnt].points[pcnt] = {};
						paths[pacnt].points[pcnt].x = px-1;
						paths[pacnt].points[pcnt].y = py-1;
						paths[pacnt].points[pcnt].t = arr[py][px];
						
						// Bounding box
						if( (px-1) < paths[pacnt].boundingbox[0] ){ paths[pacnt].boundingbox[0] = px-1; }
						if( (px-1) > paths[pacnt].boundingbox[2] ){ paths[pacnt].boundingbox[2] = px-1; }
						if( (py-1) < paths[pacnt].boundingbox[1] ){ paths[pacnt].boundingbox[1] = py-1; }
						if( (py-1) > paths[pacnt].boundingbox[3] ){ paths[pacnt].boundingbox[3] = py-1; }
						
						// Next: look up the replacement, direction and coordinate changes = clear this cell, turn if required, walk forward
						lookuprow = _this.pathscan_combined_lookup[ arr[py][px] ][ dir ];
						arr[py][px] = lookuprow[0]; dir = lookuprow[1]; px += lookuprow[2]; py += lookuprow[3];

						// Close path
						if( (px-1 === paths[pacnt].points[0].x ) && ( py-1 === paths[pacnt].points[0].y ) ){
							pathfinished = true;
							
							// Discarding paths shorter than pathomit
							if( paths[pacnt].points.length < pathomit ){
								paths.pop();
							}else{
							
								paths[pacnt].isholepath = holepath ? true : false;
								
								// Finding the parent shape for this hole
								if(holepath){
									
									var parentidx = 0, parentbbox = [-1,-1,w+1,h+1];
									for(var parentcnt=0; parentcnt < pacnt; parentcnt++){
										if( (!paths[parentcnt].isholepath) &&
											_this.boundingboxincludes( paths[parentcnt].boundingbox , paths[pacnt].boundingbox ) &&
											_this.boundingboxincludes( parentbbox , paths[parentcnt].boundingbox ) &&
											_this.pointinpoly( paths[pacnt].points[0], paths[parentcnt].points )
										){
											parentidx = parentcnt;
											parentbbox = paths[parentcnt].boundingbox;
										}
									}
									
									paths[parentidx].holechildren.push( pacnt );
									
								}// End of holepath parent finding
								
								pacnt++;
							
							}
							
						}// End of Close path
						
						pcnt++;
						
					}// End of Path points loop
					
				}// End of Follow path
				
			}// End of i loop
		}// End of j loop
		
		return paths;
	},// End of pathscan()
	
	this.boundingboxincludes = function( parentbbox, childbbox ){
		return ( ( parentbbox[0] < childbbox[0] ) && ( parentbbox[1] < childbbox[1] ) && ( parentbbox[2] > childbbox[2] ) && ( parentbbox[3] > childbbox[3] ) );
	},// End of boundingboxincludes()
	
	// 3. Batch pathscan
	this.batchpathscan = function( layers, pathomit ){
		var bpaths = [];
		for(var k in layers){
			if(!layers.hasOwnProperty(k)){ continue; }
			bpaths[k] = _this.pathscan( layers[k], pathomit );
		}
		return bpaths;
	},
	
	// 4. interpollating between path points for nodes with 8 directions ( East, SouthEast, S, SW, W, NW, N, NE )
	this.internodes = function( paths, options ){
		var ins = [], palen=0, nextidx=0, nextidx2=0, previdx=0, previdx2=0, pacnt, pcnt;
		
		// paths loop
		for(pacnt=0; pacnt<paths.length; pacnt++){
			
			ins[pacnt] = {};
			ins[pacnt].points = [];
			ins[pacnt].boundingbox = paths[pacnt].boundingbox;
			ins[pacnt].holechildren = paths[pacnt].holechildren;
			ins[pacnt].isholepath = paths[pacnt].isholepath;
			palen = paths[pacnt].points.length;
			
			// pathpoints loop
			for(pcnt=0; pcnt<palen; pcnt++){
			
				// next and previous point indexes
				nextidx = (pcnt+1)%palen; nextidx2 = (pcnt+2)%palen; previdx = (pcnt-1+palen)%palen; previdx2 = (pcnt-2+palen)%palen;
				
				// right angle enhance
				if( options.rightangleenhance && _this.testrightangle( paths[pacnt], previdx2, previdx, pcnt, nextidx, nextidx2 ) ){
					
					// Fix previous direction
					if(ins[pacnt].points.length > 0){
						ins[pacnt].points[ ins[pacnt].points.length-1 ].linesegment = _this.getdirection(
								ins[pacnt].points[ ins[pacnt].points.length-1 ].x,
								ins[pacnt].points[ ins[pacnt].points.length-1 ].y,
								paths[pacnt].points[pcnt].x,
								paths[pacnt].points[pcnt].y
							);
					}
					
					// This corner point
					ins[pacnt].points.push({
						x : paths[pacnt].points[pcnt].x,
						y : paths[pacnt].points[pcnt].y,
						linesegment : _this.getdirection(
								paths[pacnt].points[pcnt].x,
								paths[pacnt].points[pcnt].y,
								(( paths[pacnt].points[pcnt].x + paths[pacnt].points[nextidx].x ) /2),
								(( paths[pacnt].points[pcnt].y + paths[pacnt].points[nextidx].y ) /2)
							)
					});
					
				}// End of right angle enhance
				
				// interpolate between two path points
				ins[pacnt].points.push({
					x : (( paths[pacnt].points[pcnt].x + paths[pacnt].points[nextidx].x ) /2),
					y : (( paths[pacnt].points[pcnt].y + paths[pacnt].points[nextidx].y ) /2),
					linesegment : _this.getdirection(
							(( paths[pacnt].points[pcnt].x + paths[pacnt].points[nextidx].x ) /2),
							(( paths[pacnt].points[pcnt].y + paths[pacnt].points[nextidx].y ) /2),
							(( paths[pacnt].points[nextidx].x + paths[pacnt].points[nextidx2].x ) /2),
							(( paths[pacnt].points[nextidx].y + paths[pacnt].points[nextidx2].y ) /2)
						)
				});
				
			}// End of pathpoints loop
						
		}// End of paths loop
		
		return ins;
	},// End of internodes()
	
	this.testrightangle = function( path, idx1, idx2, idx3, idx4, idx5 ){
		return ( (( path.points[idx3].x === path.points[idx1].x) &&
				  ( path.points[idx3].x === path.points[idx2].x) &&
				  ( path.points[idx3].y === path.points[idx4].y) &&
				  ( path.points[idx3].y === path.points[idx5].y)
				 ) ||
				 (( path.points[idx3].y === path.points[idx1].y) &&
				  ( path.points[idx3].y === path.points[idx2].y) &&
				  ( path.points[idx3].x === path.points[idx4].x) &&
				  ( path.points[idx3].x === path.points[idx5].x)
				 )
		);
	},// End of testrightangle()
	
	this.getdirection = function( x1, y1, x2, y2 ){
		var val = 8;
		if(x1 < x2){
			if     (y1 < y2){ val = 1; }// SouthEast
			else if(y1 > y2){ val = 7; }// NE
			else            { val = 0; }// E
		}else if(x1 > x2){
			if     (y1 < y2){ val = 3; }// SW
			else if(y1 > y2){ val = 5; }// NW
			else            { val = 4; }// W
		}else{
			if     (y1 < y2){ val = 2; }// S
			else if(y1 > y2){ val = 6; }// N
			else            { val = 8; }// center, this should not happen
		}
		return val;
	},// End of getdirection()
	
	// 4. Batch interpollation
	this.batchinternodes = function( bpaths, options ){
		var binternodes = [];
		for (var k in bpaths) {
			if(!bpaths.hasOwnProperty(k)){ continue; }
			binternodes[k] = _this.internodes(bpaths[k], options);
		}
		return binternodes;
	},
	
	// 5. tracepath() : recursively trying to fit straight and quadratic spline segments on the 8 direction internode path
	
	// 5.1. Find sequences of points with only 2 segment types
	// 5.2. Fit a straight line on the sequence
	// 5.3. If the straight line fails (distance error > ltres), find the point with the biggest error
	// 5.4. Fit a quadratic spline through errorpoint (project this to get controlpoint), then measure errors on every point in the sequence
	// 5.5. If the spline fails (distance error > qtres), find the point with the biggest error, set splitpoint = fitting point
	// 5.6. Split sequence and recursively apply 5.2. - 5.6. to startpoint-splitpoint and splitpoint-endpoint sequences
	
	this.tracepath = function( path, ltres, qtres ){
		var pcnt=0, segtype1, segtype2, seqend, smp = {};
		smp.segments = [];
		smp.boundingbox = path.boundingbox;
		smp.holechildren = path.holechildren;
		smp.isholepath = path.isholepath;
		
		while(pcnt < path.points.length){
			// 5.1. Find sequences of points with only 2 segment types
			segtype1 = path.points[pcnt].linesegment; segtype2 = -1; seqend=pcnt+1;
			while(
				((path.points[seqend].linesegment === segtype1) || (path.points[seqend].linesegment === segtype2) || (segtype2 === -1))
				&& (seqend < path.points.length-1) ){
				
				if((path.points[seqend].linesegment!==segtype1) && (segtype2===-1)){ segtype2 = path.points[seqend].linesegment; }
				seqend++;
				
			}
			if(seqend === path.points.length-1){ seqend = 0; }

			// 5.2. - 5.6. Split sequence and recursively apply 5.2. - 5.6. to startpoint-splitpoint and splitpoint-endpoint sequences
			smp.segments = smp.segments.concat( _this.fitseq(path, ltres, qtres, pcnt, seqend) );
			
			// forward pcnt;
			if(seqend>0){ pcnt = seqend; }else{ pcnt = path.points.length; }
			
		}// End of pcnt loop
		
		return smp;
	},// End of tracepath()
		
	// 5.2. - 5.6. recursively fitting a straight or quadratic line segment on this sequence of path nodes,
	// called from tracepath()
	this.fitseq = function( path, ltres, qtres, seqstart, seqend ){
		// return if invalid seqend
		if( (seqend>path.points.length) || (seqend<0) ){ return []; }
		// variables
		var errorpoint=seqstart, errorval=0, curvepass=true, px, py, dist2;
		var tl = (seqend-seqstart); if(tl<0){ tl += path.points.length; }
		var vx = (path.points[seqend].x-path.points[seqstart].x) / tl,
			vy = (path.points[seqend].y-path.points[seqstart].y) / tl;
		
		// 5.2. Fit a straight line on the sequence
		var pcnt = (seqstart+1) % path.points.length, pl;
		while(pcnt != seqend){
			pl = pcnt-seqstart; if(pl<0){ pl += path.points.length; }
			px = path.points[seqstart].x + vx * pl; py = path.points[seqstart].y + vy * pl;
			dist2 = (path.points[pcnt].x-px)*(path.points[pcnt].x-px) + (path.points[pcnt].y-py)*(path.points[pcnt].y-py);
			if(dist2>ltres){curvepass=false;}
			if(dist2>errorval){ errorpoint=pcnt; errorval=dist2; }
			pcnt = (pcnt+1)%path.points.length;
		}
		// return straight line if fits
		if(curvepass){ return [{ type:'L', x1:path.points[seqstart].x, y1:path.points[seqstart].y, x2:path.points[seqend].x, y2:path.points[seqend].y }]; }
		
		// 5.3. If the straight line fails (distance error>ltres), find the point with the biggest error
		var fitpoint = errorpoint; curvepass = true; errorval = 0;
		
		// 5.4. Fit a quadratic spline through this point, measure errors on every point in the sequence
		// helpers and projecting to get control point
		var t=(fitpoint-seqstart)/tl, t1=(1-t)*(1-t), t2=2*(1-t)*t, t3=t*t;
		var cpx = (t1*path.points[seqstart].x + t3*path.points[seqend].x - path.points[fitpoint].x)/-t2 ,
			cpy = (t1*path.points[seqstart].y + t3*path.points[seqend].y - path.points[fitpoint].y)/-t2 ;
		
		// Check every point
		pcnt = seqstart+1;
		while(pcnt != seqend){
			t=(pcnt-seqstart)/tl; t1=(1-t)*(1-t); t2=2*(1-t)*t; t3=t*t;
			px = t1 * path.points[seqstart].x + t2 * cpx + t3 * path.points[seqend].x;
			py = t1 * path.points[seqstart].y + t2 * cpy + t3 * path.points[seqend].y;
			
			dist2 = (path.points[pcnt].x-px)*(path.points[pcnt].x-px) + (path.points[pcnt].y-py)*(path.points[pcnt].y-py);
			
			if(dist2>qtres){curvepass=false;}
			if(dist2>errorval){ errorpoint=pcnt; errorval=dist2; }
			pcnt = (pcnt+1)%path.points.length;
		}
		// return spline if fits
		if(curvepass){ return [{ type:'Q', x1:path.points[seqstart].x, y1:path.points[seqstart].y, x2:cpx, y2:cpy, x3:path.points[seqend].x, y3:path.points[seqend].y }]; }
		// 5.5. If the spline fails (distance error>qtres), find the point with the biggest error
		var splitpoint = fitpoint; // Earlier: Math.floor((fitpoint + errorpoint)/2);
		
		// 5.6. Split sequence and recursively apply 5.2. - 5.6. to startpoint-splitpoint and splitpoint-endpoint sequences
		return _this.fitseq( path, ltres, qtres, seqstart, splitpoint ).concat(
				_this.fitseq( path, ltres, qtres, splitpoint, seqend ) );
		
	},// End of fitseq()
	
	// 5. Batch tracing paths
	this.batchtracepaths = function(internodepaths,ltres,qtres){
		var btracedpaths = [];
		for(var k in internodepaths){
			if(!internodepaths.hasOwnProperty(k)){ continue; }
			btracedpaths.push( _this.tracepath(internodepaths[k],ltres,qtres) );
		}
		return btracedpaths;
	},
	
	// 5. Batch tracing layers
	this.batchtracelayers = function(binternodes, ltres, qtres){
		var btbis = [];
		for(var k in binternodes){
			if(!binternodes.hasOwnProperty(k)){ continue; }
			btbis[k] = _this.batchtracepaths(binternodes[k], ltres, qtres);
		}
		return btbis;
	},
	
	////////////////////////////////////////////////////////////
	//
	//  SVG Drawing functions
	//
	////////////////////////////////////////////////////////////
	
	// Rounding to given decimals https://stackoverflow.com/questions/11832914/round-to-at-most-2-decimal-places-in-javascript
	this.roundtodec = function(val,places){ return +val.toFixed(places); },
	
	// Getting SVG path element string from a traced path
	this.svgpathstring = function( tracedata, lnum, pathnum, options ){
		
		var layer = tracedata.layers[lnum], smp = layer[pathnum], str='', pcnt;
		
		// Line filter
		if(options.linefilter && (smp.segments.length < 3)){ return str; }
		
		// Starting path element, desc contains layer and path number
		str = '<path '+
			( options.desc ? ('desc="l '+lnum+' p '+pathnum+'" ') : '' ) +
			_this.tosvgcolorstr(tracedata.palette[lnum], options) +
			'd="';
		
		// Creating non-hole path string
		if( options.roundcoords === -1 ){
			str += 'M '+ smp.segments[0].x1 * options.scale +' '+ smp.segments[0].y1 * options.scale +' ';
			for(pcnt=0; pcnt<smp.segments.length; pcnt++){
				str += smp.segments[pcnt].type +' '+ smp.segments[pcnt].x2 * options.scale +' '+ smp.segments[pcnt].y2 * options.scale +' ';
				if(smp.segments[pcnt].hasOwnProperty('x3')){
					str += smp.segments[pcnt].x3 * options.scale +' '+ smp.segments[pcnt].y3 * options.scale +' ';
				}
			}
			str += 'Z ';
		}else{
			str += 'M '+ _this.roundtodec( smp.segments[0].x1 * options.scale, options.roundcoords ) +' '+ _this.roundtodec( smp.segments[0].y1 * options.scale, options.roundcoords ) +' ';
			for(pcnt=0; pcnt<smp.segments.length; pcnt++){
				str += smp.segments[pcnt].type +' '+ _this.roundtodec( smp.segments[pcnt].x2 * options.scale, options.roundcoords ) +' '+ _this.roundtodec( smp.segments[pcnt].y2 * options.scale, options.roundcoords ) +' ';
				if(smp.segments[pcnt].hasOwnProperty('x3')){
					str += _this.roundtodec( smp.segments[pcnt].x3 * options.scale, options.roundcoords ) +' '+ _this.roundtodec( smp.segments[pcnt].y3 * options.scale, options.roundcoords ) +' ';
				}
			}
			str += 'Z ';
		}// End of creating non-hole path string
		
		// Hole children
		for( var hcnt=0; hcnt < smp.holechildren.length; hcnt++){
			var hsmp = layer[ smp.holechildren[hcnt] ];
			// Creating hole path string
			if( options.roundcoords === -1 ){
				
				if(hsmp.segments[ hsmp.segments.length-1 ].hasOwnProperty('x3')){
					str += 'M '+ hsmp.segments[ hsmp.segments.length-1 ].x3 * options.scale +' '+ hsmp.segments[ hsmp.segments.length-1 ].y3 * options.scale +' ';
				}else{
					str += 'M '+ hsmp.segments[ hsmp.segments.length-1 ].x2 * options.scale +' '+ hsmp.segments[ hsmp.segments.length-1 ].y2 * options.scale +' ';
				}
				
				for(pcnt = hsmp.segments.length-1; pcnt >= 0; pcnt--){
					str += hsmp.segments[pcnt].type +' ';
					if(hsmp.segments[pcnt].hasOwnProperty('x3')){
						str += hsmp.segments[pcnt].x2 * options.scale +' '+ hsmp.segments[pcnt].y2 * options.scale +' ';
					}
					
					str += hsmp.segments[pcnt].x1 * options.scale +' '+ hsmp.segments[pcnt].y1 * options.scale +' ';
				}
				
			}else{
				
				if(hsmp.segments[ hsmp.segments.length-1 ].hasOwnProperty('x3')){
					str += 'M '+ _this.roundtodec( hsmp.segments[ hsmp.segments.length-1 ].x3 * options.scale ) +' '+ _this.roundtodec( hsmp.segments[ hsmp.segments.length-1 ].y3 * options.scale ) +' ';
				}else{
					str += 'M '+ _this.roundtodec( hsmp.segments[ hsmp.segments.length-1 ].x2 * options.scale ) +' '+ _this.roundtodec( hsmp.segments[ hsmp.segments.length-1 ].y2 * options.scale ) +' ';
				}
				
				for(pcnt = hsmp.segments.length-1; pcnt >= 0; pcnt--){
					str += hsmp.segments[pcnt].type +' ';
					if(hsmp.segments[pcnt].hasOwnProperty('x3')){
						str += _this.roundtodec( hsmp.segments[pcnt].x2 * options.scale ) +' '+ _this.roundtodec( hsmp.segments[pcnt].y2 * options.scale ) +' ';
					}
					str += _this.roundtodec( hsmp.segments[pcnt].x1 * options.scale ) +' '+ _this.roundtodec( hsmp.segments[pcnt].y1 * options.scale ) +' ';
				}
				
				
			}// End of creating hole path string
			
			str += 'Z '; // Close path
			
		}// End of holepath check
		
		// Closing path element
		str += '" />';
		
		// Rendering control points
		if(options.lcpr || options.qcpr){
			for(pcnt=0; pcnt<smp.segments.length; pcnt++){
				if( smp.segments[pcnt].hasOwnProperty('x3') && options.qcpr ){
					str += '<circle cx="'+ smp.segments[pcnt].x2 * options.scale +'" cy="'+ smp.segments[pcnt].y2 * options.scale +'" r="'+ options.qcpr +'" fill="cyan" stroke-width="'+ options.qcpr * 0.2 +'" stroke="black" />';
					str += '<circle cx="'+ smp.segments[pcnt].x3 * options.scale +'" cy="'+ smp.segments[pcnt].y3 * options.scale +'" r="'+ options.qcpr +'" fill="white" stroke-width="'+ options.qcpr * 0.2 +'" stroke="black" />';
					str += '<line x1="'+ smp.segments[pcnt].x1 * options.scale +'" y1="'+ smp.segments[pcnt].y1 * options.scale +'" x2="'+ smp.segments[pcnt].x2 * options.scale +'" y2="'+ smp.segments[pcnt].y2 * options.scale +'" stroke-width="'+ options.qcpr * 0.2 +'" stroke="cyan" />';
					str += '<line x1="'+ smp.segments[pcnt].x2 * options.scale +'" y1="'+ smp.segments[pcnt].y2 * options.scale +'" x2="'+ smp.segments[pcnt].x3 * options.scale +'" y2="'+ smp.segments[pcnt].y3 * options.scale +'" stroke-width="'+ options.qcpr * 0.2 +'" stroke="cyan" />';
				}
				if( (!smp.segments[pcnt].hasOwnProperty('x3')) && options.lcpr){
					str += '<circle cx="'+ smp.segments[pcnt].x2 * options.scale +'" cy="'+ smp.segments[pcnt].y2 * options.scale +'" r="'+ options.lcpr +'" fill="white" stroke-width="'+ options.lcpr * 0.2 +'" stroke="black" />';
				}
			}
			
			// Hole children control points
			for( var hcnt=0; hcnt < smp.holechildren.length; hcnt++){
				var hsmp = layer[ smp.holechildren[hcnt] ];
				for(pcnt=0; pcnt<hsmp.segments.length; pcnt++){
					if( hsmp.segments[pcnt].hasOwnProperty('x3') && options.qcpr ){
						str += '<circle cx="'+ hsmp.segments[pcnt].x2 * options.scale +'" cy="'+ hsmp.segments[pcnt].y2 * options.scale +'" r="'+ options.qcpr +'" fill="cyan" stroke-width="'+ options.qcpr * 0.2 +'" stroke="black" />';
						str += '<circle cx="'+ hsmp.segments[pcnt].x3 * options.scale +'" cy="'+ hsmp.segments[pcnt].y3 * options.scale +'" r="'+ options.qcpr +'" fill="white" stroke-width="'+ options.qcpr * 0.2 +'" stroke="black" />';
						str += '<line x1="'+ hsmp.segments[pcnt].x1 * options.scale +'" y1="'+ hsmp.segments[pcnt].y1 * options.scale +'" x2="'+ hsmp.segments[pcnt].x2 * options.scale +'" y2="'+ hsmp.segments[pcnt].y2 * options.scale +'" stroke-width="'+ options.qcpr * 0.2 +'" stroke="cyan" />';
						str += '<line x1="'+ hsmp.segments[pcnt].x2 * options.scale +'" y1="'+ hsmp.segments[pcnt].y2 * options.scale +'" x2="'+ hsmp.segments[pcnt].x3 * options.scale +'" y2="'+ hsmp.segments[pcnt].y3 * options.scale +'" stroke-width="'+ options.qcpr * 0.2 +'" stroke="cyan" />';
					}
					if( (!hsmp.segments[pcnt].hasOwnProperty('x3')) && options.lcpr){
						str += '<circle cx="'+ hsmp.segments[pcnt].x2 * options.scale +'" cy="'+ hsmp.segments[pcnt].y2 * options.scale +'" r="'+ options.lcpr +'" fill="white" stroke-width="'+ options.lcpr * 0.2 +'" stroke="black" />';
					}
				}
			}
		}// End of Rendering control points
			
		return str;
		
	},// End of svgpathstring()
	
	// Converting tracedata to an SVG string
	this.getsvgstring = function( tracedata, options ){
		
		options = _this.checkoptions(options);
		
		var w = tracedata.width * options.scale, h = tracedata.height * options.scale;
		
		// SVG start
		var svgstr = '<svg ' + (options.viewbox ? ('viewBox="0 0 '+w+' '+h+'" ') : ('width="'+w+'" height="'+h+'" ')) +
			'version="1.1" xmlns="http://www.w3.org/2000/svg" desc="Created with imagetracer.js version '+_this.versionnumber+'" >';

		// Drawing: Layers and Paths loops
		for(var lcnt=0; lcnt < tracedata.layers.length; lcnt++){
			for(var pcnt=0; pcnt < tracedata.layers[lcnt].length; pcnt++){
				
				// Adding SVG <path> string
				if( !tracedata.layers[lcnt][pcnt].isholepath ){
					svgstr += _this.svgpathstring( tracedata, lcnt, pcnt, options );
				}
					
			}// End of paths loop
		}// End of layers loop
		
		// SVG End
		svgstr+='</svg>';
		
		return svgstr;
		
	},// End of getsvgstring()
	
	// Comparator for numeric Array.sort
	this.compareNumbers = function(a,b){ return a - b; },
	
	// Convert color object to rgba string
	this.torgbastr = function(c){ return 'rgba('+c.r+','+c.g+','+c.b+','+c.a+')'; },
	
	// Convert color object to SVG color string
	this.tosvgcolorstr = function(c, options){
		return 'fill="rgb('+c.r+','+c.g+','+c.b+')" stroke="rgb('+c.r+','+c.g+','+c.b+')" stroke-width="'+options.strokewidth+'" opacity="'+c.a/255.0+'" ';
	},
	
	// Helper function: Appending an <svg> element to a container from an svgstring
	this.appendSVGString = function(svgstr,parentid){
		var div;
		if(parentid){
			div = document.getElementById(parentid);
			if(!div){
				div = document.createElement('div');
				div.id = parentid;
				document.body.appendChild(div);
			}
		}else{
			div = document.createElement('div');
			document.body.appendChild(div);
		}
		div.innerHTML += svgstr;
	},
	
	////////////////////////////////////////////////////////////
	//
	//  Canvas functions
	//
	////////////////////////////////////////////////////////////
	
	// Gaussian kernels for blur
	this.gks = [ [0.27901,0.44198,0.27901], [0.135336,0.228569,0.272192,0.228569,0.135336], [0.086776,0.136394,0.178908,0.195843,0.178908,0.136394,0.086776],
	             [0.063327,0.093095,0.122589,0.144599,0.152781,0.144599,0.122589,0.093095,0.063327], [0.049692,0.069304,0.089767,0.107988,0.120651,0.125194,0.120651,0.107988,0.089767,0.069304,0.049692] ],
	
	// Selective Gaussian blur for preprocessing
	this.blur = function(imgd,radius,delta){
		var i,j,k,d,idx,racc,gacc,bacc,aacc,wacc;
		
		// new ImageData
		var imgd2 = { width:imgd.width, height:imgd.height, data:[] };
		
		// radius and delta limits, this kernel
		radius = Math.floor(radius); if(radius<1){ return imgd; } if(radius>5){ radius = 5; } delta = Math.abs( delta ); if(delta>1024){ delta = 1024; }
		var thisgk = _this.gks[radius-1];
		
		// loop through all pixels, horizontal blur
		for( j=0; j < imgd.height; j++ ){
			for( i=0; i < imgd.width; i++ ){

				racc = 0; gacc = 0; bacc = 0; aacc = 0; wacc = 0;
				// gauss kernel loop
				for( k = -radius; k < radius+1; k++){
					// add weighted color values
					if( (i+k > 0) && (i+k < imgd.width) ){
						idx = (j*imgd.width+i+k)*4;
						racc += imgd.data[idx  ] * thisgk[k+radius];
						gacc += imgd.data[idx+1] * thisgk[k+radius];
						bacc += imgd.data[idx+2] * thisgk[k+radius];
						aacc += imgd.data[idx+3] * thisgk[k+radius];
						wacc += thisgk[k+radius];
					}
				}
				// The new pixel
				idx = (j*imgd.width+i)*4;
				imgd2.data[idx  ] = Math.floor(racc / wacc);
				imgd2.data[idx+1] = Math.floor(gacc / wacc);
				imgd2.data[idx+2] = Math.floor(bacc / wacc);
				imgd2.data[idx+3] = Math.floor(aacc / wacc);
				
			}// End of width loop
		}// End of horizontal blur
		
		// copying the half blurred imgd2
		var himgd = new Uint8ClampedArray(imgd2.data);
		
		// loop through all pixels, vertical blur
		for( j=0; j < imgd.height; j++ ){
			for( i=0; i < imgd.width; i++ ){

				racc = 0; gacc = 0; bacc = 0; aacc = 0; wacc = 0;
				// gauss kernel loop
				for( k = -radius; k < radius+1; k++){
					// add weighted color values
					if( (j+k > 0) && (j+k < imgd.height) ){
						idx = ((j+k)*imgd.width+i)*4;
						racc += himgd[idx  ] * thisgk[k+radius];
						gacc += himgd[idx+1] * thisgk[k+radius];
						bacc += himgd[idx+2] * thisgk[k+radius];
						aacc += himgd[idx+3] * thisgk[k+radius];
						wacc += thisgk[k+radius];
					}
				}
				// The new pixel
				idx = (j*imgd.width+i)*4;
				imgd2.data[idx  ] = Math.floor(racc / wacc);
				imgd2.data[idx+1] = Math.floor(gacc / wacc);
				imgd2.data[idx+2] = Math.floor(bacc / wacc);
				imgd2.data[idx+3] = Math.floor(aacc / wacc);
				
			}// End of width loop
		}// End of vertical blur
		
		// Selective blur: loop through all pixels
		for( j=0; j < imgd.height; j++ ){
			for( i=0; i < imgd.width; i++ ){
				
				idx = (j*imgd.width+i)*4;
				// d is the difference between the blurred and the original pixel
				d = Math.abs(imgd2.data[idx  ] - imgd.data[idx  ]) + Math.abs(imgd2.data[idx+1] - imgd.data[idx+1]) +
					Math.abs(imgd2.data[idx+2] - imgd.data[idx+2]) + Math.abs(imgd2.data[idx+3] - imgd.data[idx+3]);
				// selective blur: if d>delta, put the original pixel back
				if(d>delta){
					imgd2.data[idx  ] = imgd.data[idx  ];
					imgd2.data[idx+1] = imgd.data[idx+1];
					imgd2.data[idx+2] = imgd.data[idx+2];
					imgd2.data[idx+3] = imgd.data[idx+3];
				}
			}
		}// End of Selective blur
		
		return imgd2;
		
	},// End of blur()
	
	// Helper function: loading an image from a URL, then executing callback with canvas as argument
	this.loadImage = function(url,callback,options){
		var img = new Image();
		if(options && options.corsenabled){ img.crossOrigin = 'Anonymous'; }
		img.onload = function(){
			var canvas = document.createElement('canvas');
			canvas.width = img.width;
			canvas.height = img.height;
			var context = canvas.getContext('2d');
			context.drawImage(img,0,0);
			callback(canvas);
		};
		img.src = url;
	},
	
	// Helper function: getting ImageData from a canvas
	this.getImgdata = function(canvas){
		var context = canvas.getContext('2d');
		return context.getImageData(0,0,canvas.width,canvas.height);
	},
	
	// Special palette to use with drawlayers()
	this.specpalette = [
		{r:0,g:0,b:0,a:255}, {r:128,g:128,b:128,a:255}, {r:0,g:0,b:128,a:255}, {r:64,g:64,b:128,a:255},
		{r:192,g:192,b:192,a:255}, {r:255,g:255,b:255,a:255}, {r:128,g:128,b:192,a:255}, {r:0,g:0,b:192,a:255},
		{r:128,g:0,b:0,a:255}, {r:128,g:64,b:64,a:255}, {r:128,g:0,b:128,a:255}, {r:168,g:168,b:168,a:255},
		{r:192,g:128,b:128,a:255}, {r:192,g:0,b:0,a:255}, {r:255,g:255,b:255,a:255}, {r:0,g:128,b:0,a:255}
	],
	
	// Helper function: Drawing all edge node layers into a container
	this.drawLayers = function(layers,palette,scale,parentid){
		scale = scale||1;
		var w,h,i,j,k;
		
		// Preparing container
		var div;
		if(parentid){
			div = document.getElementById(parentid);
			if(!div){
				div = document.createElement('div');
				div.id = parentid;
				document.body.appendChild(div);
			}
		}else{
			div = document.createElement('div');
			document.body.appendChild(div);
		}
		
		// Layers loop
		for (k in layers) {
			if(!layers.hasOwnProperty(k)){ continue; }
			
			// width, height
			w=layers[k][0].length; h=layers[k].length;
			
			// Creating new canvas for every layer
			var canvas = document.createElement('canvas'); canvas.width=w*scale; canvas.height=h*scale;
			var context = canvas.getContext('2d');
			
			// Drawing
			for(j=0; j<h; j++){
				for(i=0; i<w; i++){
					context.fillStyle = _this.torgbastr(palette[ layers[k][j][i]%palette.length ]);
					context.fillRect(i*scale,j*scale,scale,scale);
				}
			}
			
			// Appending canvas to container
			div.appendChild(canvas);
		}// End of Layers loop
	}// End of drawlayers
	
	;// End of function list
	
}// End of ImageTracer object

// export as AMD module / Node module / browser or worker variable
if(typeof define === 'function' && define.amd){
	define(function() { return new ImageTracer(); });
}else if(typeof module !== 'undefined'){
	module.exports = new ImageTracer();
}else if(typeof self !== 'undefined'){
	self.ImageTracer = new ImageTracer();
}else window.ImageTracer = new ImageTracer();

})();

(function (global, factory) {
    if (typeof define === "function" && define.amd) {
        define(["module"], factory);
    } else if (typeof exports !== "undefined") {
        factory(module);
    } else {
        var mod = {
            exports: {}
        };
        factory(mod);
        global.fitCurve = mod.exports;
    }
})(this, function (module) {
    "use strict";

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    /**
     *  @preserve  JavaScript implementation of
     *  Algorithm for Automatically Fitting Digitized Curves
     *  by Philip J. Schneider
     *  "Graphics Gems", Academic Press, 1990
     *
     *  The MIT License (MIT)
     *
     *  https://github.com/soswow/fit-curves
     */

    /**
     * Fit one or more Bezier curves to a set of points.
     *
     * @param {Array<Array<Number>>} points - Array of digitized points, e.g. [[5,5],[5,50],[110,140],[210,160],[320,110]]
     * @param {Number} maxError - Tolerance, squared error between points and fitted curve
     * @returns {Array<Array<Array<Number>>>} Array of Bezier curves, where each element is [first-point, control-point-1, control-point-2, second-point] and points are [x, y]
     */
    function fitCurve(points, maxError, progressCallback) {
        if (!Array.isArray(points)) {
            throw new TypeError("First argument should be an array");
        }
        points.forEach(function (point) {
            if (!Array.isArray(point) || point.some(function (item) {
                return typeof item !== 'number';
            }) || point.length !== points[0].length) {
                throw Error("Each point should be an array of numbers. Each point should have the same amount of numbers.");
            }
        });

        // Remove duplicate points
        points = points.filter(function (point, i) {
            return i === 0 || !point.every(function (val, j) {
                return val === points[i - 1][j];
            });
        });

        if (points.length < 2) {
            return [];
        }

        var len = points.length;
        var leftTangent = createTangent(points[1], points[0]);
        var rightTangent = createTangent(points[len - 2], points[len - 1]);

        return fitCubic(points, leftTangent, rightTangent, maxError, progressCallback);
    }

    /**
     * Fit a Bezier curve to a (sub)set of digitized points.
     * Your code should not call this function directly. Use {@link fitCurve} instead.
     *
     * @param {Array<Array<Number>>} points - Array of digitized points, e.g. [[5,5],[5,50],[110,140],[210,160],[320,110]]
     * @param {Array<Number>} leftTangent - Unit tangent vector at start point
     * @param {Array<Number>} rightTangent - Unit tangent vector at end point
     * @param {Number} error - Tolerance, squared error between points and fitted curve
     * @returns {Array<Array<Array<Number>>>} Array of Bezier curves, where each element is [first-point, control-point-1, control-point-2, second-point] and points are [x, y]
     */
    function fitCubic(points, leftTangent, rightTangent, error, progressCallback) {
        var MaxIterations = 20; //Max times to try iterating (to find an acceptable curve)

        var bezCurve, //Control points of fitted Bezier curve
        u, //Parameter values for point
        uPrime, //Improved parameter values
        maxError, prevErr, //Maximum fitting error
        splitPoint, prevSplit, //Point to split point set at if we need more than one curve
        centerVector, toCenterTangent, fromCenterTangent, //Unit tangent vector(s) at splitPoint
        beziers, //Array of fitted Bezier curves if we need more than one curve
        dist, i;

        //console.log('fitCubic, ', points.length);

        //Use heuristic if region only has two points in it
        if (points.length === 2) {
            dist = maths.vectorLen(maths.subtract(points[0], points[1])) / 3.0;
            bezCurve = [points[0], maths.addArrays(points[0], maths.mulItems(leftTangent, dist)), maths.addArrays(points[1], maths.mulItems(rightTangent, dist)), points[1]];
            return [bezCurve];
        }

        //Parameterize points, and attempt to fit curve
        u = chordLengthParameterize(points);

        var _generateAndReport = generateAndReport(points, u, u, leftTangent, rightTangent, progressCallback);

        bezCurve = _generateAndReport[0];
        maxError = _generateAndReport[1];
        splitPoint = _generateAndReport[2];


        if (maxError === 0 || maxError < error) {
            return [bezCurve];
        }
        //If error not too large, try some reparameterization and iteration
        if (maxError < error * error) {

            uPrime = u;
            prevErr = maxError;
            prevSplit = splitPoint;

            for (i = 0; i < MaxIterations; i++) {

                uPrime = reparameterize(bezCurve, points, uPrime);

                var _generateAndReport2 = generateAndReport(points, u, uPrime, leftTangent, rightTangent, progressCallback);

                bezCurve = _generateAndReport2[0];
                maxError = _generateAndReport2[1];
                splitPoint = _generateAndReport2[2];


                if (maxError < error) {
                    return [bezCurve];
                }
                //If the development of the fitted curve grinds to a halt,
                //we abort this attempt (and try a shorter curve):
                else if (splitPoint === prevSplit) {
                        var errChange = maxError / prevErr;
                        if (errChange > .9999 && errChange < 1.0001) {
                            break;
                        }
                    }

                prevErr = maxError;
                prevSplit = splitPoint;
            }
        }

        //Fitting failed -- split at max error point and fit recursively
        beziers = [];

        //To create a smooth transition from one curve segment to the next, we
        //calculate the line between the points directly before and after the
        //center, and use that as the tangent both to and from the center point.
        centerVector = maths.subtract(points[splitPoint - 1], points[splitPoint + 1]);
        //However, this won't work if they're the same point, because the line we
        //want to use as a tangent would be 0. Instead, we calculate the line from
        //that "double-point" to the center point, and use its tangent.
        if (centerVector.every(function (val) {
            return val === 0;
        })) {
            //[x,y] -> [-y,x]: http://stackoverflow.com/a/4780141/1869660
            centerVector = maths.subtract(points[splitPoint - 1], points[splitPoint]);
            var _ref = [-centerVector[1], centerVector[0]];
            centerVector[0] = _ref[0];
            centerVector[1] = _ref[1];
        }
        toCenterTangent = maths.normalize(centerVector);
        //To and from need to point in opposite directions:
        fromCenterTangent = maths.mulItems(toCenterTangent, -1);

        /*
        Note: An alternative to this "divide and conquer" recursion could be to always
              let new curve segments start by trying to go all the way to the end,
              instead of only to the end of the current subdivided polyline.
              That might let many segments fit a few points more, reducing the number of total segments.
               However, a few tests have shown that the segment reduction is insignificant
              (240 pts, 100 err: 25 curves vs 27 curves. 140 pts, 100 err: 17 curves on both),
              and the results take twice as many steps and milliseconds to finish,
              without looking any better than what we already have.
        */
        beziers = beziers.concat(fitCubic(points.slice(0, splitPoint + 1), leftTangent, toCenterTangent, error, progressCallback));
        beziers = beziers.concat(fitCubic(points.slice(splitPoint), fromCenterTangent, rightTangent, error, progressCallback));
        return beziers;
    };

    function generateAndReport(points, paramsOrig, paramsPrime, leftTangent, rightTangent, progressCallback) {
        var bezCurve, maxError, splitPoint;

        bezCurve = generateBezier(points, paramsPrime, leftTangent, rightTangent, progressCallback);
        //Find max deviation of points to fitted curve.
        //Here we always use the original parameters (from chordLengthParameterize()),
        //because we need to compare the current curve to the actual source polyline,
        //and not the currently iterated parameters which reparameterize() & generateBezier() use,
        //as those have probably drifted far away and may no longer be in ascending order.

        var _computeMaxError = computeMaxError(points, bezCurve, paramsOrig);

        maxError = _computeMaxError[0];
        splitPoint = _computeMaxError[1];


        if (progressCallback) {
            progressCallback({
                bez: bezCurve,
                points: points,
                params: paramsOrig,
                maxErr: maxError,
                maxPoint: splitPoint
            });
        }

        return [bezCurve, maxError, splitPoint];
    }

    /**
     * Use least-squares method to find Bezier control points for region.
     *
     * @param {Array<Array<Number>>} points - Array of digitized points
     * @param {Array<Number>} parameters - Parameter values for region
     * @param {Array<Number>} leftTangent - Unit tangent vector at start point
     * @param {Array<Number>} rightTangent - Unit tangent vector at end point
     * @returns {Array<Array<Number>>} Approximated Bezier curve: [first-point, control-point-1, control-point-2, second-point] where points are [x, y]
     */
    function generateBezier(points, parameters, leftTangent, rightTangent) {
        var bezCurve,
            //Bezier curve ctl pts
        A,
            a,
            //Precomputed rhs for eqn
        C,
            X,
            //Matrices C & X
        det_C0_C1,
            det_C0_X,
            det_X_C1,
            //Determinants of matrices
        alpha_l,
            alpha_r,
            //Alpha values, left and right

        epsilon,
            segLength,
            i,
            len,
            tmp,
            u,
            ux,
            firstPoint = points[0],
            lastPoint = points[points.length - 1];

        bezCurve = [firstPoint, null, null, lastPoint];
        //console.log('gb', parameters.length);

        //Compute the A's
        A = maths.zeros_Xx2x2(parameters.length);
        for (i = 0, len = parameters.length; i < len; i++) {
            u = parameters[i];
            ux = 1 - u;
            a = A[i];

            a[0] = maths.mulItems(leftTangent, 3 * u * (ux * ux));
            a[1] = maths.mulItems(rightTangent, 3 * ux * (u * u));
        }

        //Create the C and X matrices
        C = [[0, 0], [0, 0]];
        X = [0, 0];
        for (i = 0, len = points.length; i < len; i++) {
            u = parameters[i];
            a = A[i];

            C[0][0] += maths.dot(a[0], a[0]);
            C[0][1] += maths.dot(a[0], a[1]);
            C[1][0] += maths.dot(a[0], a[1]);
            C[1][1] += maths.dot(a[1], a[1]);

            tmp = maths.subtract(points[i], bezier.q([firstPoint, firstPoint, lastPoint, lastPoint], u));

            X[0] += maths.dot(a[0], tmp);
            X[1] += maths.dot(a[1], tmp);
        }

        //Compute the determinants of C and X
        det_C0_C1 = C[0][0] * C[1][1] - C[1][0] * C[0][1];
        det_C0_X = C[0][0] * X[1] - C[1][0] * X[0];
        det_X_C1 = X[0] * C[1][1] - X[1] * C[0][1];

        //Finally, derive alpha values
        alpha_l = det_C0_C1 === 0 ? 0 : det_X_C1 / det_C0_C1;
        alpha_r = det_C0_C1 === 0 ? 0 : det_C0_X / det_C0_C1;

        //If alpha negative, use the Wu/Barsky heuristic (see text).
        //If alpha is 0, you get coincident control points that lead to
        //divide by zero in any subsequent NewtonRaphsonRootFind() call.
        segLength = maths.vectorLen(maths.subtract(firstPoint, lastPoint));
        epsilon = 1.0e-6 * segLength;
        if (alpha_l < epsilon || alpha_r < epsilon) {
            //Fall back on standard (probably inaccurate) formula, and subdivide further if needed.
            bezCurve[1] = maths.addArrays(firstPoint, maths.mulItems(leftTangent, segLength / 3.0));
            bezCurve[2] = maths.addArrays(lastPoint, maths.mulItems(rightTangent, segLength / 3.0));
        } else {
            //First and last control points of the Bezier curve are
            //positioned exactly at the first and last data points
            //Control points 1 and 2 are positioned an alpha distance out
            //on the tangent vectors, left and right, respectively
            bezCurve[1] = maths.addArrays(firstPoint, maths.mulItems(leftTangent, alpha_l));
            bezCurve[2] = maths.addArrays(lastPoint, maths.mulItems(rightTangent, alpha_r));
        }

        return bezCurve;
    };

    /**
     * Given set of points and their parameterization, try to find a better parameterization.
     *
     * @param {Array<Array<Number>>} bezier - Current fitted curve
     * @param {Array<Array<Number>>} points - Array of digitized points
     * @param {Array<Number>} parameters - Current parameter values
     * @returns {Array<Number>} New parameter values
     */
    function reparameterize(bezier, points, parameters) {
        /*
        var j, len, point, results, u;
        results = [];
        for (j = 0, len = points.length; j < len; j++) {
            point = points[j], u = parameters[j];
             results.push(newtonRaphsonRootFind(bezier, point, u));
        }
        return results;
        //*/
        return parameters.map(function (p, i) {
            return newtonRaphsonRootFind(bezier, points[i], p);
        });
    };

    /**
     * Use Newton-Raphson iteration to find better root.
     *
     * @param {Array<Array<Number>>} bez - Current fitted curve
     * @param {Array<Number>} point - Digitized point
     * @param {Number} u - Parameter value for "P"
     * @returns {Number} New u
     */
    function newtonRaphsonRootFind(bez, point, u) {
        /*
            Newton's root finding algorithm calculates f(x)=0 by reiterating
            x_n+1 = x_n - f(x_n)/f'(x_n)
            We are trying to find curve parameter u for some point p that minimizes
            the distance from that point to the curve. Distance point to curve is d=q(u)-p.
            At minimum distance the point is perpendicular to the curve.
            We are solving
            f = q(u)-p * q'(u) = 0
            with
            f' = q'(u) * q'(u) + q(u)-p * q''(u)
            gives
            u_n+1 = u_n - |q(u_n)-p * q'(u_n)| / |q'(u_n)**2 + q(u_n)-p * q''(u_n)|
        */

        var d = maths.subtract(bezier.q(bez, u), point),
            qprime = bezier.qprime(bez, u),
            numerator = maths.mulMatrix(d, qprime),
            denominator = maths.sum(maths.squareItems(qprime)) + 2 * maths.mulMatrix(d, bezier.qprimeprime(bez, u));

        if (denominator === 0) {
            return u;
        } else {
            return u - numerator / denominator;
        }
    };

    /**
     * Assign parameter values to digitized points using relative distances between points.
     *
     * @param {Array<Array<Number>>} points - Array of digitized points
     * @returns {Array<Number>} Parameter values
     */
    function chordLengthParameterize(points) {
        var u = [],
            currU,
            prevU,
            prevP;

        points.forEach(function (p, i) {
            currU = i ? prevU + maths.vectorLen(maths.subtract(p, prevP)) : 0;
            u.push(currU);

            prevU = currU;
            prevP = p;
        });
        u = u.map(function (x) {
            return x / prevU;
        });

        return u;
    };

    /**
     * Find the maximum squared distance of digitized points to fitted curve.
     *
     * @param {Array<Array<Number>>} points - Array of digitized points
     * @param {Array<Array<Number>>} bez - Fitted curve
     * @param {Array<Number>} parameters - Parameterization of points
     * @returns {Array<Number>} Maximum error (squared) and point of max error
     */
    function computeMaxError(points, bez, parameters) {
        var dist, //Current error
        maxDist, //Maximum error
        splitPoint, //Point of maximum error
        v, //Vector from point to curve
        i, count, point, t;

        maxDist = 0;
        splitPoint = Math.floor(points.length / 2);

        var t_distMap = mapTtoRelativeDistances(bez, 10);

        for (i = 0, count = points.length; i < count; i++) {
            point = points[i];
            //Find 't' for a point on the bez curve that's as close to 'point' as possible:
            t = find_t(bez, parameters[i], t_distMap, 10);

            v = maths.subtract(bezier.q(bez, t), point);
            dist = v[0] * v[0] + v[1] * v[1];

            if (dist > maxDist) {
                maxDist = dist;
                splitPoint = i;
            }
        }

        return [maxDist, splitPoint];
    };

    //Sample 't's and map them to relative distances along the curve:
    var mapTtoRelativeDistances = function mapTtoRelativeDistances(bez, B_parts) {
        var B_t_curr;
        var B_t_dist = [0];
        var B_t_prev = bez[0];
        var sumLen = 0;

        for (var i = 1; i <= B_parts; i++) {
            B_t_curr = bezier.q(bez, i / B_parts);

            sumLen += maths.vectorLen(maths.subtract(B_t_curr, B_t_prev));

            B_t_dist.push(sumLen);
            B_t_prev = B_t_curr;
        }

        //Normalize B_length to the same interval as the parameter distances; 0 to 1:
        B_t_dist = B_t_dist.map(function (x) {
            return x / sumLen;
        });
        return B_t_dist;
    };

    function find_t(bez, param, t_distMap, B_parts) {
        if (param < 0) {
            return 0;
        }
        if (param > 1) {
            return 1;
        }

        /*
            'param' is a value between 0 and 1 telling us the relative position
            of a point on the source polyline (linearly from the start (0) to the end (1)).
            To see if a given curve - 'bez' - is a close approximation of the polyline,
            we compare such a poly-point to the point on the curve that's the same
            relative distance along the curve's length.
             But finding that curve-point takes a little work:
            There is a function "B(t)" to find points along a curve from the parametric parameter 't'
            (also relative from 0 to 1: http://stackoverflow.com/a/32841764/1869660
                                        http://pomax.github.io/bezierinfo/#explanation),
            but 't' isn't linear by length (http://gamedev.stackexchange.com/questions/105230).
             So, we sample some points along the curve using a handful of values for 't'.
            Then, we calculate the length between those samples via plain euclidean distance;
            B(t) concentrates the points around sharp turns, so this should give us a good-enough outline of the curve.
            Thus, for a given relative distance ('param'), we can now find an upper and lower value
            for the corresponding 't' by searching through those sampled distances.
            Finally, we just use linear interpolation to find a better value for the exact 't'.
             More info:
                http://gamedev.stackexchange.com/questions/105230/points-evenly-spaced-along-a-bezier-curve
                http://stackoverflow.com/questions/29438398/cheap-way-of-calculating-cubic-bezier-length
                http://steve.hollasch.net/cgindex/curves/cbezarclen.html
                https://github.com/retuxx/tinyspline
        */
        var lenMax, lenMin, tMax, tMin, t;

        //Find the two t-s that the current param distance lies between,
        //and then interpolate a somewhat accurate value for the exact t:
        for (var i = 1; i <= B_parts; i++) {

            if (param <= t_distMap[i]) {
                tMin = (i - 1) / B_parts;
                tMax = i / B_parts;
                lenMin = t_distMap[i - 1];
                lenMax = t_distMap[i];

                t = (param - lenMin) / (lenMax - lenMin) * (tMax - tMin) + tMin;
                break;
            }
        }
        return t;
    }

    /**
     * Creates a vector of length 1 which shows the direction from B to A
     */
    function createTangent(pointA, pointB) {
        return maths.normalize(maths.subtract(pointA, pointB));
    }

    /*
        Simplified versions of what we need from math.js
        Optimized for our input, which is only numbers and 1x2 arrays (i.e. [x, y] coordinates).
    */

    var maths = function () {
        function maths() {
            _classCallCheck(this, maths);
        }

        maths.zeros_Xx2x2 = function zeros_Xx2x2(x) {
            var zs = [];
            while (x--) {
                zs.push([0, 0]);
            }
            return zs;
        };

        maths.mulItems = function mulItems(items, multiplier) {
            return items.map(function (x) {
                return x * multiplier;
            });
        };

        maths.mulMatrix = function mulMatrix(m1, m2) {
            //https://en.wikipedia.org/wiki/Matrix_multiplication#Matrix_product_.28two_matrices.29
            //Simplified to only handle 1-dimensional matrices (i.e. arrays) of equal length:
            return m1.reduce(function (sum, x1, i) {
                return sum + x1 * m2[i];
            }, 0);
        };

        maths.subtract = function subtract(arr1, arr2) {
            return arr1.map(function (x1, i) {
                return x1 - arr2[i];
            });
        };

        maths.addArrays = function addArrays(arr1, arr2) {
            return arr1.map(function (x1, i) {
                return x1 + arr2[i];
            });
        };

        maths.addItems = function addItems(items, addition) {
            return items.map(function (x) {
                return x + addition;
            });
        };

        maths.sum = function sum(items) {
            return items.reduce(function (sum, x) {
                return sum + x;
            });
        };

        maths.dot = function dot(m1, m2) {
            return maths.mulMatrix(m1, m2);
        };

        maths.vectorLen = function vectorLen(v) {
            return Math.hypot.apply(Math, v);
        };

        maths.divItems = function divItems(items, divisor) {
            return items.map(function (x) {
                return x / divisor;
            });
        };

        maths.squareItems = function squareItems(items) {
            return items.map(function (x) {
                return x * x;
            });
        };

        maths.normalize = function normalize(v) {
            return this.divItems(v, this.vectorLen(v));
        };

        return maths;
    }();

    var bezier = function () {
        function bezier() {
            _classCallCheck(this, bezier);
        }

        bezier.q = function q(ctrlPoly, t) {
            var tx = 1.0 - t;
            var pA = maths.mulItems(ctrlPoly[0], tx * tx * tx),
                pB = maths.mulItems(ctrlPoly[1], 3 * tx * tx * t),
                pC = maths.mulItems(ctrlPoly[2], 3 * tx * t * t),
                pD = maths.mulItems(ctrlPoly[3], t * t * t);
            return maths.addArrays(maths.addArrays(pA, pB), maths.addArrays(pC, pD));
        };

        bezier.qprime = function qprime(ctrlPoly, t) {
            var tx = 1.0 - t;
            var pA = maths.mulItems(maths.subtract(ctrlPoly[1], ctrlPoly[0]), 3 * tx * tx),
                pB = maths.mulItems(maths.subtract(ctrlPoly[2], ctrlPoly[1]), 6 * tx * t),
                pC = maths.mulItems(maths.subtract(ctrlPoly[3], ctrlPoly[2]), 3 * t * t);
            return maths.addArrays(maths.addArrays(pA, pB), pC);
        };

        bezier.qprimeprime = function qprimeprime(ctrlPoly, t) {
            return maths.addArrays(maths.mulItems(maths.addArrays(maths.subtract(ctrlPoly[2], maths.mulItems(ctrlPoly[1], 2)), ctrlPoly[0]), 6 * (1.0 - t)), maths.mulItems(maths.addArrays(maths.subtract(ctrlPoly[3], maths.mulItems(ctrlPoly[2], 2)), ctrlPoly[1]), 6 * t));
        };

        return bezier;
    }();

    module.exports = fitCurve;
    module.exports.fitCubic = fitCubic;
    module.exports.createTangent = createTangent;
});



// Recognized polygons constrain shared edges, so neighboring regions use the
// same straight geometry and identical color-junction coordinates.
function polygonConstraints(layers,s){
 const edges=new Map(),vertices=new Map(),key=p=>p.x+','+p.y,edge=(a,b)=>a<b?a+'|'+b:b+'|'+a;
 if(!s.geometry||!s.corners)return {chain:()=>null,point:p=>p};
 const project=(p,a,b)=>{const x=b[0]-a[0],y=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/(x*x+y*y)));return [a[0]+t*x,a[1]+t*y]};
 for(const layer of layers)for(const path of layer){const d=geometricPolygon(path.points);if(!d)continue;const values=d.match(/-?\d+(?:\.\d+)?/g).map(Number),poly=[];for(let i=0;i<values.length;i+=2)poly.push([values[i],values[i+1]]);const nearest=p=>{let side=0,q=null,error=Infinity;for(let j=0;j<poly.length;j++){const z=project(p,poly[j],poly[(j+1)%poly.length]),e=Math.hypot(p[0]-z[0],p[1]-z[1]);if(e<error){side=j;q=z;error=e;}}return {side,q}};
  for(let i=0;i<path.points.length;i++){const a=path.points[i],b=path.points[(i+1)%path.points.length],mid=[(a.x+b.x)/2,(a.y+b.y)/2];edges.set(edge(key(a),key(b)),{poly,side:nearest(mid).side});const z=nearest([a.x,a.y]).q;vertices.set(key(a),{x:z[0],y:z[1]});}
 }
 function point(p){return vertices.get(key(p))||p;}
 function chain(raw){const es=[];for(let i=1;i<raw.length;i++){const e=edges.get(edge(key(raw[i-1]),key(raw[i])));if(!e||es.length&&e.poly!==es[0].poly)return null;es.push(e);}if(!es.length)return null;const poly=es[0].poly,first=point(raw[0]),last=point(raw.at(-1)),out=[[first.x,first.y]];for(let i=1;i<es.length;i++){const a=es[i-1].side,b=es[i].side;if(a===b)continue;if((a+1)%poly.length===b)out.push(poly[b]);else if((b+1)%poly.length===a)out.push(poly[a]);else return null;}out.push([last.x,last.y]);const result=[];for(let i=1;i<out.length;i++)if(Math.hypot(out[i][0]-out[i-1][0],out[i][1]-out[i-1][1])>.0001)result.push({type:'L',p:[out[i-1],out[i]]});return result;}
 return {chain,point};
}

// Circular fit through fixed shared endpoints. Conservative raster tolerance.
function fitCircularArc(raw){
 if(raw.length<40)return null;const pts=raw.map(p=>Array.isArray(p)?p:[p.x,p.y]),a=pts[0],b=pts.at(-1),dx=b[0]-a[0],dy=b[1]-a[1],chord=Math.hypot(dx,dy);if(chord<8)return null;
 const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,nx=-dy/chord,ny=dx/chord;let sum=0,den=0;
 for(const p of pts){const x=p[0]-mx,y=p[1]-my,z=2*(x*nx+y*ny);sum+=z*(x*x+y*y-chord*chord/4);den+=z*z;}if(den<1e-6)return null;
 const t=sum/den,cx=mx+t*nx,cy=my+t*ny,r=Math.hypot(chord/2,t);if(!Number.isFinite(r)||r<12)return null;
 let error=0,turn=0,travel=0,previous=Math.atan2(a[1]-cy,a[0]-cx);const first=previous;
 for(const p of pts){const e=Math.abs(Math.hypot(p[0]-cx,p[1]-cy)-r);if(e>1.5)return null;error+=e*e;const angle=Math.atan2(p[1]-cy,p[0]-cx);let delta=angle-previous;while(delta>Math.PI)delta-=2*Math.PI;while(delta<-Math.PI)delta+=2*Math.PI;turn+=delta;travel+=Math.abs(delta);previous=angle;}
 if(Math.sqrt(error/pts.length)>.55||Math.abs(turn)<Math.PI/3||Math.abs(turn)>Math.PI*2-.02||travel-Math.abs(turn)>.04)return null;
 const count=Math.ceil(Math.abs(turn)/(Math.PI/4)),step=turn/count,out=[];let start=a;
 for(let i=0;i<count;i++){const u=first+i*step,v=u+step,k=4/3*Math.tan(step/4),end=i===count-1?b:[cx+r*Math.cos(v),cy+r*Math.sin(v)];out.push({type:'C',p:[start,[start[0]-k*r*Math.sin(u),start[1]+k*r*Math.cos(u)],[end[0]+k*r*Math.sin(v),end[1]-k*r*Math.cos(v)],end]});start=end;}
 return out;
}

// Fit each boundary chain once. Straight runs are fixed before fitting curves.
function mixedFit(raw,s,closed=false,requireLine=false){
 const src=raw.map(p=>Array.isArray(p)?p:[p.x,p.y]);if(src.length<2)return [];
 let loX=Infinity,loY=Infinity,hiX=-Infinity,hiY=-Infinity;for(const p of src){loX=Math.min(loX,p[0]);loY=Math.min(loY,p[1]);hiX=Math.max(hiX,p[0]);hiY=Math.max(hiY,p[1]);}const small=Math.max(hiX-loX,hiY-loY)<35;if(small)s={...s,smooth:Math.min(1,s.smooth),corners:true};
 let p=src.slice();if(closed){
  const n=src.length,k=Math.min(5,Math.floor(n/4)),a=src[(n-k)%n],b=src[0],c=src[k],u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]],dot=(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1);
  if(dot>.7&&s.smooth>0){const sigma=Math.min(1.5,.5+s.smooth*.3);let x=0,y=0,w=0;for(let j=-4;j<=4;j++){const z=Math.exp(-j*j/(2*sigma*sigma)),q=src[(j+n)%n];x+=q[0]*z;y+=q[1]*z;w+=z}p[0]=[x/w,y/w];}p.push(p[0]);
 }
 const reduced=simplifyOpen(p,1.1),indices=reduced.map(v=>p.indexOf(v));indices[indices.length-1]=p.length-1;
 const lines=[];
 function line(a,b){
  if(b-a<(small?7:20))return null;const q=p.slice(a,b+1);let cx=0,cy=0;for(const v of q){cx+=v[0];cy+=v[1]}cx/=q.length;cy/=q.length;
  let xx=0,yy=0,xy=0;for(const v of q){let x=v[0]-cx,y=v[1]-cy;xx+=x*x;yy+=y*y;xy+=x*y}
  let t=.5*Math.atan2(2*xy,xx-yy),u=[Math.cos(t),Math.sin(t)];if((p[b][0]-p[a][0])*u[0]+(p[b][1]-p[a][1])*u[1]<0)u=u.map(v=>-v);
  const proj=v=>{const d=(v[0]-cx)*u[0]+(v[1]-cy)*u[1];return [cx+d*u[0],cy+d*u[1]]};
  const x=proj(p[a]),y=proj(p[b]);if(Math.hypot(y[0]-x[0],y[1]-x[1])<(small?7:30))return null;
  let sum=0,max=0;for(const v of q){const e=Math.abs((v[0]-cx)*u[1]-(v[1]-cy)*u[0]);sum+=e*e;max=Math.max(max,e)}
  if(max>(small?.7:1.5)||Math.sqrt(sum/q.length)>(small?.35:.65))return null;
  // A smooth arc has a systematic bow even if its short chord fits closely.
  const quarters=[[],[],[],[]];for(let i=0;i<q.length;i++)quarters[Math.min(3,Math.floor(i*4/q.length))].push((q[i][0]-cx)*u[1]-(q[i][1]-cy)*u[0]);
  const avg=quarters.map(v=>v.reduce((a,b)=>a+b,0)/v.length);if(Math.abs((avg[0]+avg[3]-avg[1]-avg[2])/2)>.38)return null;
  return {a,b,x,y,u};
 }
 if(s.geometry){for(let j=0;j<indices.length-1;j++){let best=line(indices[j],indices[j+1]),last=j+1;if(!best)continue;for(let k=j+2;k<indices.length;k++){const c=line(indices[j],indices[k]);if(!c)break;best=c;last=k}lines.push(best);j=last-1;}}
 if(requireLine&&!lines.length)return null;
 // Reserve a transition zone beside curves; do not consume their rounded ends.
 for(let i=0;i<lines.length;i++){const l=lines[i],trim=Math.min(8,Math.floor((l.b-l.a)/8)),project=v=>{const t=(v[0]-l.x[0])*l.u[0]+(v[1]-l.x[1])*l.u[1];return [l.x[0]+t*l.u[0],l.x[1]+t*l.u[1]]};
  const a=l.a,b=l.b;if(a>0&&(i===0||lines[i-1].b!==a||(!s.corners&&lines[i-1].u[0]*l.u[0]+lines[i-1].u[1]*l.u[1]<.99))){l.a+=trim;l.x=project(p[l.a]);}if(b<p.length-1&&(i===lines.length-1||lines[i+1].a!==b||(!s.corners&&lines[i+1].u[0]*l.u[0]+lines[i+1].u[1]*l.u[1]<.99))){l.b-=trim;l.y=project(p[l.b]);}
 }

 // Keep true color junctions fixed, so all incident boundaries meet exactly.
 if(!closed){if(lines[0]?.a===0)lines[0].x=p[0];if(lines.at(-1)?.b===p.length-1)lines.at(-1).y=p.at(-1);}
 for(let i=1;i<lines.length;i++){const a=lines[i-1],b=lines[i];if(a.b!==b.a)continue;const det=a.u[0]*b.u[1]-a.u[1]*b.u[0];let v=p[b.a];if(Math.abs(det)>.15){const dx=b.x[0]-a.x[0],dy=b.x[1]-a.x[1],t=(dx*b.u[1]-dy*b.u[0])/det,z=[a.x[0]+t*a.u[0],a.x[1]+t*a.u[1]];if(Math.hypot(z[0]-v[0],z[1]-v[1])<2)v=z;}a.y=v;b.x=v;}
 if(closed&&lines.length){if(lines[0].a===0)lines[0].x=p[0];if(lines.at(-1).b===p.length-1)lines.at(-1).y=p[0];}
 const out=[],sigma=[0,.7,1.05,1.5,2.1,2.8][s.smooth],error=[.3,.55,.85,1.2,1.65,2.2][s.smooth];
 const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l)};
 function curve(a,b,left,right){if(b<=a)return;let q=p.slice(a,b+1).map(v=>v.slice());if(left)q[0]=left.y.slice();if(right)q[q.length-1]=right.x.slice();
  // Corner anchors stay fixed; only the interiors of their spans are smoothed.
  const cuts=[0],k=Math.min(6,Math.floor(q.length/5));if(s.corners&&k>=2){for(let i=k;i<q.length-k;i++){const u=norm([q[i][0]-q[i-k][0],q[i][1]-q[i-k][1]]),v=norm([q[i+k][0]-q[i][0],q[i+k][1]-q[i][1]]);if(u[0]*v[0]+u[1]*v[1]<.35&&i-cuts.at(-1)>k*2)cuts.push(i)}}cuts.push(q.length-1);
  for(let c=1;c<cuts.length;c++){let span=q.slice(cuts[c-1],cuts[c]+1),r=Math.ceil(sigma*2);if(sigma)span=span.map((v,i)=>{if(i===0||i===span.length-1)return v;let x=0,y=0,w=0;for(let j=-r;j<=r;j++){const t=Math.max(0,Math.min(span.length-1,i+j)),z=Math.exp(-j*j/(2*sigma*sigma));x+=span[t][0]*z;y+=span[t][1]*z;w+=z}return [x/w,y/w]});
   let lt=norm([span[1][0]-span[0][0],span[1][1]-span[0][1]]),rt=norm([span.at(-2)[0]-span.at(-1)[0],span.at(-2)[1]-span.at(-1)[1]]);
   if(closed&&a===0&&c===1&&!left)lt=norm([p[1][0]-p[p.length-2][0],p[1][1]-p[p.length-2][1]]);if(closed&&b===p.length-1&&c===cuts.length-1&&!right)rt=norm([p[p.length-2][0]-p[1][0],p[p.length-2][1]-p[1][1]]);
   const lk=Math.min(5,span.length-1),rv=norm([span[span.length-1-lk][0]-span.at(-1)[0],span[span.length-1-lk][1]-span.at(-1)[1]]),lv=norm([span[lk][0]-span[0][0],span[lk][1]-span[0][1]]);if(c===1&&left&&lv[0]*left.u[0]+lv[1]*left.u[1]>.3)lt=left.u;
   if(c===cuts.length-1&&right&&-rv[0]*right.u[0]-rv[1]*right.u[1]>.3)rt=right.u.map(v=>-v);
   let curves=fitCurve.fitCubic(span,lt,rt,error*error);const xs=span.map(v=>v[0]),ys=span.map(v=>v[1]),minX=Math.min(...xs)-3,maxX=Math.max(...xs)+3,minY=Math.min(...ys)-3,maxY=Math.max(...ys)+3;
   if(curves.some(c=>c.some(v=>!v.every(Number.isFinite))||Array.from({length:15},(_,i)=>{const t=(i+1)/16,u=1-t,v=[0,1].map(k=>u*u*u*c[0][k]+3*u*u*t*c[1][k]+3*u*t*t*c[2][k]+t*t*t*c[3][k]);return v[0]<minX||v[0]>maxX||v[1]<minY||v[1]>maxY}).some(Boolean))){const poly=simplifyOpen(span,.4);for(let i=1;i<poly.length;i++)out.push({type:'L',p:[poly[i-1],poly[i]]});}else for(const v of curves)out.push({type:'C',p:v});
  }
 }
 let at=0,prev=null;for(const l of lines){curve(at,l.a,prev,l);out.push({type:'L',p:[l.x,l.y]});at=l.b;prev=l;}curve(at,p.length-1,prev,null);
 return out;
}
function mixedString(segments,move=true){if(!segments.length)return '';const f=p=>p.map(v=>+v.toFixed(3)).join(' ');return (move?'M '+f(segments[0].p[0])+' ':'')+segments.map(s=>s.type+' '+s.p.slice(1).map(f).join(' ')).join(' ')+' ';}
function reverseSegments(segs){return segs.slice().reverse().map(s=>({type:s.type,p:s.p.slice().reverse()}));}
// Original-pixel refinement of shared color chains. Independent implementation.
// Keep graph connectivity and junction anchors; never fit neighboring colors separately.
function refineColorChain(raw,colors,src){
 if(!src||colors.length!==2||raw.length<9)return raw;
 const [a,b]=colors;if(!a?.a||!b?.a)return raw;
 const v=[b.r-a.r,b.g-a.g,b.b-a.b],den=v.reduce((n,z)=>n+z*z,0);if(den<60*60)return raw;
 function sample(x,y){x-=.5;y-=.5;if(x<0||y<0||x>=src.width-1||y>=src.height-1)return null;const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,c=[0,0,0];let alpha=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=((iy+dy)*src.width+ix+dx)*4,w=(dx?fx:1-fx)*(dy?fy:1-fy);alpha+=w*src.data[i+3]/255;for(let k=0;k<3;k++)c[k]+=w*src.data[i+k];}
  if(alpha<.99)return null;const u=c.map((z,k)=>z-[a.r,a.g,a.b][k]),t=u.reduce((n,z,k)=>n+z*v[k],0)/den,res=u.reduce((n,z,k)=>n+(z-t*v[k])**2,0);return res<=24*24?t:null;
 }
 const out=raw.slice();
 for(let i=3;i<raw.length-3;i++){
  const p=raw[i],l=raw[i-3],r=raw[i+3],ux=p.x-l.x,uy=p.y-l.y,vx=r.x-p.x,vy=r.y-p.y;
  if((ux*vx+uy*vy)/(Math.hypot(ux,uy)*Math.hypot(vx,vy)||1)<.75)continue;
  const dx=r.x-l.x,dy=r.y-l.y,len=Math.hypot(dx,dy);if(!len)continue;const nx=-dy/len,ny=dx/len;
  let lo=-.8,hi=.8,t0=sample(p.x+nx*lo,p.y+ny*lo),t1=sample(p.x+nx*hi,p.y+ny*hi);
  if(t0===null||t1===null||Math.abs(t1-t0)<.25||(t0-.5)*(t1-.5)>0)continue;
  let valid=true;for(let k=0;k<9;k++){const mid=(lo+hi)/2,t=sample(p.x+nx*mid,p.y+ny*mid);if(t===null){valid=false;break;}if((t0-.5)*(t-.5)<=0)hi=mid;else{lo=mid;t0=t;}}
  if(valid){const offset=(lo+hi)/2;out[i]={...p,x:p.x+nx*offset,y:p.y+ny*offset};}
 }
 return out;
}
// Bound fitted curves to the measured chain, using sampled segments and local search.
function chainFitError(segments,points){
 if(!segments?.length)return Infinity;const poly=[];
 for(const s of segments){if(s.type==='L'){poly.push(s.p[0],s.p[1]);continue;}if(s.type!=='C')return Infinity;
  for(let j=0;j<=12;j++){const t=j/12,u=1-t;poly.push([0,1].map(k=>u*u*u*s.p[0][k]+3*u*u*t*s.p[1][k]+3*u*t*t*s.p[2][k]+t*t*t*s.p[3][k]));}}
 // Linear traversal is adequate for ordered, non-self-crossing boundary chains.
 let cursor=0,max=0;for(const p of points){let best=Infinity,at=cursor;for(let j=Math.max(0,cursor-3);j<Math.min(poly.length-1,cursor+30);j++){const e=distanceSegment([p.x,p.y],poly[j],poly[j+1]);if(e<best){best=e;at=j;}}cursor=at;max=Math.max(max,best);}return max;
}
function fitRefinedChain(raw,s,colors){
 const measured=refineColorChain(raw,colors,colorTraceSource);
 const changed=measured.some((p,i)=>p!==raw[i]);if(!changed)return null;
 const precise={...s,smooth:Math.min(s.smooth,1)},candidate=mixedFit(measured,precise);
 // Reject large departures; retain the old fitter rather than damaging the shared edge.
 if(chainFitError(candidate,measured)>.8)return null;
 return candidate;
}

let seamUnderlay=new Map(),seamSeen=new Set();
function addSeam(c,d){if(!d||seamSeen.has(d))return;seamSeen.add(d);const color='rgb('+c.r+','+c.g+','+c.b+')';if(!seamUnderlay.has(color))seamUnderlay.set(color,[]);seamUnderlay.get(color).push(d);}
function sharedContours(layers,s){
 const graph=new Map(),key=p=>p.x+','+p.y;
 for(const layer of layers)for(const path of layer){const p=path.points;for(let i=0;i<p.length;i++){const a=key(p[i]),b=key(p[(i+1)%p.length]);if(!graph.has(a))graph.set(a,new Set());if(!graph.has(b))graph.set(b,new Set());graph.get(a).add(b);graph.get(b).add(a);}}
 const edgeColors=new Map(),edgeKey=(a,b)=>a<b?a+'|'+b:b+'|'+a;
 for(const layer of layers)for(const path of layer){const points=path.points;for(let i=0;i<points.length;i++){const k=edgeKey(key(points[i]),key(points[(i+1)%points.length]));if(!edgeColors.has(k))edgeColors.set(k,new Set());edgeColors.get(k).add(path.traceColor);}}
 const constraints=polygonConstraints(layers,s);
 const cache=new Map();
 return layers.map(layer=>layer.map(path=>{const p=path.points,n=p.length,junctions=[];for(let i=0;i<n;i++)if(graph.get(key(p[i])).size!==2)junctions.push(i);
  if(!junctions.length){const d=fitContour(path,s);if(s.seams!==false&&n>1){const own=edgeColors.get(edgeKey(key(p[0]),key(p[1])));if(own&&own.size===2)addSeam([...own][0],d);}return d;}
  let all=[];for(let j=0;j<junctions.length;j++){const start=junctions[j],end=junctions[(j+1)%junctions.length],chain=[p[start]];let i=(start+1)%n;while(i!==end){chain.push(p[i]);i=(i+1)%n}chain.push(p[end]);
   const forward=chain.map(key).join(';'),back=chain.slice().reverse().map(key).join(';'),reverse=back<forward,k=reverse?back:forward;
   if(!cache.has(k)){const raw=reverse?chain.slice().reverse():chain;let segments=constraints.chain(raw);if(!segments){const adjusted=raw.slice();adjusted[0]=constraints.point(raw[0]);adjusted[adjusted.length-1]=constraints.point(raw.at(-1));const owners=new Set();for(let i=1;i<raw.length;i++)for(const c of edgeColors.get(edgeKey(key(raw[i-1]),key(raw[i])))||[])owners.add(c);segments=fitRefinedChain(adjusted,s,[...owners])||(s.geometry?fitCircularArc(adjusted):null)||mixedFit(adjusted,s);}cache.set(k,segments);
    if(s.seams!==false&&segments.length){const own=new Set();for(let i=1;i<raw.length;i++)for(const c of edgeColors.get(edgeKey(key(raw[i-1]),key(raw[i])))||[])own.add(c);if(own.size===2)addSeam([...own][0],mixedString(segments));}}const seg=cache.get(k);all.push(...(reverse?reverseSegments(seg):seg));
  }return mixedString(all)+'Z ';
 }));
}

// Conservative polygon reconstruction. Accept only long, straight sides whose
// fitted intersections remain within a bounded distance of the source contour.
function distanceSegment(p,a,b){const x=b[0]-a[0],y=b[1]-a[1],l=x*x+y*y,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/l)):0;return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y)}
function simplifyOpen(p,tol){if(p.length<3)return p;let stack=[[0,p.length-1]],keep=new Set([0,p.length-1]);while(stack.length){const [a,b]=stack.pop();let d=tol,k=-1;for(let i=a+1;i<b;i++){const e=distanceSegment(p[i],p[a],p[b]);if(e>d){d=e;k=i}}if(k>=0){keep.add(k);stack.push([a,k],[k,b])}}return [...keep].sort((a,b)=>a-b).map(i=>p[i])}
function closedPolygon(points,tol){let far=1,max=0;for(let i=1;i<points.length;i++){let d=Math.hypot(points[i][0]-points[0][0],points[i][1]-points[0][1]);if(d>max){max=d;far=i}}return simplifyOpen(points.slice(0,far+1),tol).slice(0,-1).concat(simplifyOpen(points.slice(far).concat([points[0]]),tol).slice(0,-1))}
function polygonCrosses(p){const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){if(i===0&&j===p.length-1)continue;let a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return true}return false}
function geometricPolygon(raw){
 const pts=raw.map(p=>[p.x,p.y]);if(pts.length<24)return '';
 const tol=2.5,rough=closedPolygon(pts,3);if(rough.length<3||rough.length>32)return '';
 // A polygon corner must concentrate its turn near the vertex. Distributed
 // turning belongs to a curve, even when a many-sided polygon could approximate it.
 for(let i=0;i<rough.length;i++){
  const a=rough[(i+rough.length-1)%rough.length],b=rough[i],c=rough[(i+1)%rough.length];
  const angle=(a,b,c)=>{const u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]];return Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1))))};
  const k=Math.max(2,Math.min(10,Math.floor(Math.min(Math.hypot(b[0]-a[0],b[1]-a[1]),Math.hypot(c[0]-b[0],c[1]-b[1]))*.2))),j=pts.indexOf(b);
  if(angle(pts[(j-k+pts.length)%pts.length],b,pts[(j+k)%pts.length])<angle(a,b,c)*.85)return '';
 }
 const lines=[];
 for(let j=0;j<rough.length;j++){
  const a=rough[j],b=rough[(j+1)%rough.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<16)return '';
  let start=pts.indexOf(a),end=pts.indexOf(b),span=[];for(let i=start;i!==end;i=(i+1)%pts.length)span.push(pts[i]);span.push(b);
  // Fit the interior of each side so rasterized corner stair steps do not bias it.
  const core=span.slice(Math.min(8,Math.floor(span.length/8)),-Math.min(8,Math.floor(span.length/8)));if(core.length<4)return '';let cx=0,cy=0;for(const p of core){cx+=p[0];cy+=p[1]}cx/=core.length;cy/=core.length;
  let xx=0,xy=0,yy=0;for(const p of core){let x=p[0]-cx,y=p[1]-cy;xx+=x*x;xy+=x*y;yy+=y*y}
  const ang=.5*Math.atan2(2*xy,xx-yy),u=[Math.cos(ang),Math.sin(ang)];
  if(core.some(p=>Math.abs((p[0]-cx)*u[1]-(p[1]-cy)*u[0])>1.05))return '';
  const checks=span.slice(3,-3).map(p=>(p[0]-cx)*u[1]-(p[1]-cy)*u[0]);if(Math.sqrt(checks.reduce((a,e)=>a+e*e,0)/checks.length)>.65)return '';const bins=[[],[],[],[]];checks.forEach((e,i)=>bins[Math.min(3,Math.floor(i*4/checks.length))].push(e));const means=bins.map(b=>b.reduce((a,e)=>a+e,0)/b.length);if(Math.abs((means[0]+means[3]-means[1]-means[2])/2)>.38)return '';lines.push({p:[cx,cy],u});
 }
 let out=[];for(let i=0;i<lines.length;i++){
  const a=lines[(i+lines.length-1)%lines.length],b=lines[i],det=a.u[0]*b.u[1]-a.u[1]*b.u[0];if(Math.abs(det)<.23)return '';
  const dx=b.p[0]-a.p[0],dy=b.p[1]-a.p[1],t=(dx*b.u[1]-dy*b.u[0])/det;
  const v=[a.p[0]+t*a.u[0],a.p[1]+t*a.u[1]];if(Math.hypot(v[0]-rough[i][0],v[1]-rough[i][1])>3.5)return '';out.push(v);
 }
 if(polygonCrosses(out))return '';
 if(pts.some(p=>Math.min(...out.map((a,i)=>distanceSegment(p,a,out[(i+1)%out.length])))>tol))return '';
 // Reverse distance protects against shortcuts across concave details.
 for(let i=0;i<out.length;i++){const a=out[i],b=out[(i+1)%out.length],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);for(let k=0;k<=steps;k++){const p=[a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps];let best=Infinity;for(let t=0;t<pts.length;t++)best=Math.min(best,distanceSegment(p,pts[t],pts[(t+1)%pts.length]));if(best>tol)return ''}}
 const f=p=>p.map(v=>+v.toFixed(3)).join(' ');return 'M '+f(out[0])+' '+out.slice(1).map(p=>'L '+f(p)).join(' ')+' Z ';
}

function geometricCircle(raw){
 if(raw.length<32)return '';let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of raw){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y)}
 const w=maxX-minX,h=maxY-minY;if(Math.min(w,h)<12||Math.abs(w-h)>1)return '';const cx=(minX+maxX)/2,cy=(minY+maxY)/2,rs=raw.map(p=>Math.hypot(p.x-cx,p.y-cy)).sort((a,b)=>a-b),r=rs[Math.floor(rs.length/2)];if(rs.some(v=>Math.abs(v-r)>.85))return '';
 // Require complete angular coverage, not merely a partial circular boundary.
 const bins=new Set(raw.map(p=>Math.floor((Math.atan2(p.y-cy,p.x-cx)+Math.PI)*16/Math.PI)));if(bins.size<30)return '';
 const f=v=>+v.toFixed(3);return 'M '+f(cx+r)+' '+f(cy)+' A '+f(r)+' '+f(r)+' 0 1 1 '+f(cx-r)+' '+f(cy)+' A '+f(r)+' '+f(r)+' 0 1 1 '+f(cx+r)+' '+f(cy)+' Z ';
}

function geometricEllipse(raw){
 if(raw.length<32)return '';let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of raw){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y)}
 const rx=(maxX-minX)/2,ry=(maxY-minY)/2,cx=(minX+maxX)/2,cy=(minY+maxY)/2;if(Math.min(rx,ry)<6||rx/ry<.5||rx/ry>2)return '';
 let error=0;const bins=new Set();for(const p of raw){const x=(p.x-cx)/rx,y=(p.y-cy)/ry,e=Math.abs(Math.hypot(x,y)-1)*Math.min(rx,ry);if(e>2.1)return '';error+=e*e;bins.add(Math.floor((Math.atan2(y,x)+Math.PI)*16/Math.PI))}if(Math.sqrt(error/raw.length)>1.0||bins.size<30)return '';
 const f=v=>+v.toFixed(3);return 'M '+f(cx+rx)+' '+f(cy)+' A '+f(rx)+' '+f(ry)+' 0 1 1 '+f(cx-rx)+' '+f(cy)+' A '+f(rx)+' '+f(ry)+' 0 1 1 '+f(cx+rx)+' '+f(cy)+' Z ';
}

let geometryCache=[];
function geometricCapsule(points){
 const n=points.length;if(n<24)return '';
 let cx=0,cy=0;for(const p of points){cx+=p.x;cy+=p.y}cx/=n;cy/=n;
 let xx=0,xy=0,yy=0;for(const p of points){const x=p.x-cx,y=p.y-cy;xx+=x*x;xy+=x*y;yy+=y*y}
 const theta=.5*Math.atan2(2*xy,xx-yy),co=Math.cos(theta),si=Math.sin(theta);let lo=Infinity,hi=-Infinity,bot=Infinity,top=-Infinity;
 const uv=points.map(p=>{const x=p.x-cx,y=p.y-cy,u=x*co+y*si,v=-x*si+y*co;lo=Math.min(lo,u);hi=Math.max(hi,u);bot=Math.min(bot,v);top=Math.max(top,v);return [u,v]});
 const length=hi-lo,width=top-bot;if(width<5||length<35||length/width<4)return '';
 const mu=(hi+lo)/2,mv=(bot+top)/2;let sides=uv.filter(p=>Math.abs(p[0]-mu)<length/2-width).map(p=>Math.abs(p[1]-mv)).sort((a,b)=>a-b);
 if(sides.length<12)return '';const radius=sides[Math.floor(sides.length/2)],half=length/2-radius;if(radius<2||half<radius)return '';
 let errors=uv.map(p=>Math.abs(Math.hypot(Math.max(0,Math.abs(p[0]-mu)-half),p[1]-mv)-radius)).sort((a,b)=>a-b);
 if(errors[Math.floor(n*.95)]>Math.max(1.3,radius*.16)||errors[n-1]>Math.max(2.5,radius*.32))return '';
 const center=[cx+mu*co-mv*si,cy+mu*si+mv*co];
 for(const cached of geometryCache){if(Math.hypot(center[0]-cached.x,center[1]-cached.y)<1.5&&Math.abs(radius-cached.r)<1&&Math.abs(half-cached.h)<2&&Math.abs(Math.sin(theta-cached.angle))<.01)return cached.d;}
 const fmt=v=>+v.toFixed(3),p=(u,v)=>fmt(cx+(mu+u)*co-(mv+v)*si)+' '+fmt(cy+(mu+u)*si+(mv+v)*co),r=fmt(radius);
 const d='M '+p(-half,-radius)+' L '+p(half,-radius)+' A '+r+' '+r+' 0 0 1 '+p(half,radius)+' L '+p(-half,radius)+' A '+r+' '+r+' 0 0 1 '+p(-half,-radius)+' Z ';geometryCache.push({x:center[0],y:center[1],r:radius,h:half,angle:theta,d});return d;
}

function preprocessPixels(data,width,height,mode){
 if(!mode||mode==='none')return data;
 const out=new Uint8ClampedArray(data),radius=2,sigma=mode==='blur'?.65:1.25,offsets=[];
 for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)offsets.push([dx,dy,Math.exp(-(dx*dx+dy*dy)/(2*sigma*sigma))]);
 const range=new Float32Array(12194);for(let i=0;i<range.length;i++)range[i]=Math.exp(-(i*16)/(2*24*24));
 for(let y=0;y<height;y++){
  if(y%192===0)postMessage({phase:(mode==='blur'?'Blur tipis':'Bersihkan tekstur, jaga tepi')+' · '+Math.round(y/height*100)+'%'});
  for(let x=0;x<width;x++){
   const idx=(y*width+x)*4;if(data[idx+3]<128)continue;let sum=0,r=0,g=0,b=0;
   for(const [dx,dy,spatial] of offsets){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;const j=(yy*width+xx)*4;if(data[j+3]<128)continue;
    const dr=data[j]-data[idx],dg=data[j+1]-data[idx+1],db=data[j+2]-data[idx+2];
    const weight=spatial*(mode==='edge'?range[Math.min(12193,Math.round((dr*dr+dg*dg+db*db)/16))]:1);
    sum+=weight;r+=data[j]*weight;g+=data[j+1]*weight;b+=data[j+2]*weight;
   }
   if(sum){out[idx]=r/sum;out[idx+1]=g/sum;out[idx+2]=b/sum;}
  }
 }
 return out;
}

function mergeFragments(ii,pal,level){
 if(!level)return;const grid=ii.array,h=grid.length-2,w=grid[0].length-2,seen=new Uint8Array(w*h),queue=new Int32Array(w*h),regions=[];
 const limit=[0,4,12,24,48][level];
 for(let y=1;y<=h;y++)for(let x=1;x<=w;x++){
  const pos=(y-1)*w+x-1,c=grid[y][x];if(seen[pos]||!pal[c].a)continue;let head=0,tail=1;queue[0]=pos;seen[pos]=1;let perimeter=0;
  while(head<tail){const p=queue[head++],py=Math.floor(p/w)+1,px=p%w+1;
   for(const [nx,ny]of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]){if(nx<1||ny<1||nx>w||ny>h||grid[ny][nx]!==c){perimeter++;continue}const np=(ny-1)*w+nx-1;if(!seen[np]){seen[np]=1;queue[tail++]=np}}
  }
  if(tail<=limit||(tail<=limit*4&&perimeter/tail>1.5))regions.push({c,pixels:queue.slice(0,tail),thin:tail>limit});
 }
 regions.sort((a,b)=>a.pixels.length-b.pixels.length);
 for(const r of regions){const contacts=new Map();for(const p of r.pixels){const y=Math.floor(p/w)+1,x=p%w+1;for(const [nx,ny]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){const c=grid[ny][nx];if(c>=0&&c!==r.c&&pal[c].a)contacts.set(c,(contacts.get(c)||0)+1)}}
  if(!contacts.size||(r.thin&&contacts.size<2))continue;
  if(contacts.size===1&&r.pixels.length>2){const c=contacts.keys().next().value,a=pal[r.c],b=pal[c];if(Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b)>65)continue;}
  let best=-1,score=-1;for(const [c,edges]of contacts){const a=pal[r.c],b=pal[c],distance=Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);const rank=edges/(1+distance/80);if(rank>score){score=rank;best=c}}
  if(best>=0)for(const p of r.pixels)grid[Math.floor(p/w)+1][p%w+1]=best;
 }
}

// Remove small near-color islands without merging distant colors or glyph holes.
function mergeToneIslands(ii,pal,level){
 if(!level)return;const g=ii.array,h=g.length-2,w=g[0].length-2,seen=new Uint8Array(w*h),queue=new Int32Array(w*h),small=[];
 const limit=[0,48,120,320,480][level],distance=[0,16,22,30,36][level];
 for(let y=1;y<=h;y++)for(let x=1;x<=w;x++){const pos=(y-1)*w+x-1,c=g[y][x];if(seen[pos]||!pal[c]?.a)continue;let head=0,tail=1;queue[0]=pos;seen[pos]=1;const contacts=new Map();while(head<tail){const p=queue[head++],py=Math.floor(p/w)+1,px=p%w+1;for(const [nx,ny]of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]){const k=g[ny]?.[nx];if(k!==c){if(pal[k]?.a)contacts.set(k,(contacts.get(k)||0)+1);continue}const np=(ny-1)*w+nx-1;if(!seen[np]){seen[np]=1;queue[tail++]=np}}}if(tail<=limit)small.push({c,pixels:queue.slice(0,tail),contacts});}
 for(const r of small){let best=-1,score=0;const total=[...r.contacts.values()].reduce((a,b)=>a+b,0);for(const [k,n]of r.contacts){const a=pal[r.c],b=pal[k],d=Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);if(d<=distance&&n>=total*.2&&n/(1+d)>score){best=k;score=n/(1+d)}}if(best>=0)for(const p of r.pixels)g[Math.floor(p/w)+1][p%w+1]=best;}
}

// Cubic fitting of closed contours; corner anchors are fitted as separate spans.
let contourCache=new Map();
function fitContour(path,settings){
 const p=path.points;if(!p.length)return '';let first=0;for(let i=1;i<p.length;i++)if(p[i].x<p[first].x||(p[i].x===p[first].x&&p[i].y<p[first].y))first=i;
 const a=p[(first+1)%p.length],b=p[(first+p.length-1)%p.length],dir=a.x<b.x||(a.x===b.x&&a.y<b.y)?1:-1;
 let key='';for(let j=0;j<p.length;j++){const q=p[(first+dir*j+p.length)%p.length];key+=q.x+','+q.y+';'}
 if(contourCache.has(key))return contourCache.get(key);const d=fitContourUncached(path,settings);contourCache.set(key,d);return d;
}
// Fit a closed region with Potrace; callers with shared junctions retain shared fitting.
let colorTraceSource=null;
function potraceClosedContour(path){
 const raw=path.points;
 if(raw.length<4)return '';
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const p of raw){x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y);}
 x0=Math.floor(x0)-1;y0=Math.floor(y0)-1;const w=Math.ceil(x1)-x0+2,h=Math.ceil(y1)-y0+2;
 if(w<3||h<3)return '';
 let bm=new PotraceBrowser.Bitmap(w,h);bm.data.fill(255);let scale=1;
 // Original raster-boundary polygon -> pixel-center scan conversion.
 for(let y=0;y<h;y++){const py=y+y0+.5,xs=[];for(let j=0;j<raw.length;j++){const a=raw[j],b=raw[(j+1)%raw.length];if((a.y>py)!==(b.y>py))xs.push(a.x+(py-a.y)*(b.x-a.x)/(b.y-a.y));}xs.sort((a,b)=>a-b);for(let j=0;j+1<xs.length;j+=2){const left=Math.max(0,Math.ceil(xs[j]-x0-.5)),right=Math.min(w,Math.ceil(xs[j+1]-x0-.5));for(let x=left;x<right;x++)bm.data[y*w+x]=0;}}
 // Small isolated contours use original antialiased pixels before quantization.
 if(bm.data.reduce((n,v)=>n+(v===0?1:0),0)>=80&&Math.max(w,h)<80&&colorTraceSource&&path.traceColor){
  const src=colorTraceSource,counts=new Map();let fg=path.traceColor;
  for(let y=Math.max(0,y0);y<Math.min(src.height,y0+h);y++)for(let x=Math.max(0,x0);x<Math.min(src.width,x0+w);x++){const i=(y*src.width+x)*4;let best=0,d=Infinity;for(let k=0;k<src.pal.length;k++){const p=src.pal[k];if(!p.a)continue;const e=(src.data[i]-p.r)**2+(src.data[i+1]-p.g)**2+(src.data[i+2]-p.b)**2;if(e<d){d=e;best=k;}}if(src.pal[best]!==fg)counts.set(best,(counts.get(best)||0)+1);}
  const k=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];let bg=src.pal[k];if(path.isholepath&&bg){const z=fg;fg=bg;bg=z;}
  if(bg){const v=[fg.r-bg.r,fg.g-bg.g,fg.b-bg.b],den=v.reduce((n,x)=>n+x*x,0);
   if(den>80*80){const original=bm;scale=3;bm=new PotraceBrowser.Bitmap(w*scale,h*scale);bm.data.fill(255);
    const sample=(x,y)=>{x=Math.max(0,Math.min(src.width-1,x));y=Math.max(0,Math.min(src.height-1,y));const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let t=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=(Math.min(src.height-1,iy+dy)*src.width+Math.min(src.width-1,ix+dx))*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy);if(src.data[i+3]>=128)t+=weight*((src.data[i]-bg.r)*v[0]+(src.data[i+1]-bg.g)*v[1]+(src.data[i+2]-bg.b)*v[2])/den;}return t;};
    for(let y=0;y<h*scale;y++)for(let x=0;x<w*scale;x++)if(sample(x0+(x+.5)/scale-.5,y0+(y+.5)/scale-.5)>.5)bm.data[y*w*scale+x]=0;
    // Keep only the component overlapping this contour, excluding neighboring details.
    const seen=new Uint8Array(bm.data.length),queue=new Int32Array(bm.data.length),W=w*scale,H=h*scale;let chosen=[],best=-1;
    for(let i=0;i<bm.data.length;i++){if(seen[i]||bm.data[i]!==0)continue;let read=0,end=1,score=0;queue[0]=i;seen[i]=1;while(read<end){const j=queue[read++],x=j%W,y=(j/W)|0;if(original.data[Math.floor(y/scale)*w+Math.floor(x/scale)]===0)score++;for(const k of [x?j-1:-1,x<W-1?j+1:-1,y?j-W:-1,y<H-1?j+W:-1])if(k>=0&&!seen[k]&&bm.data[k]===0){seen[k]=1;queue[end++]=k;}}if(score>best){best=score;chosen=Array.from(queue.slice(0,end));}}
    if(best>0){bm.data.fill(255);for(const i of chosen)bm.data[i]=0;}else{bm=original;scale=1;}
   }
  }
 }
 const tracer=new PotraceBrowser.Potrace({threshold:128,turdSize:0,alphaMax:1,optCurve:true,optTolerance:(scale>1?.1:.2)*scale});tracer._luminanceData=bm;tracer._imageLoaded=true;tracer._bmToPathlist();tracer._processPath();tracer._processed=true;
 // Hole contours are appended once by the color layer assembler.
 if(scale>1)tracer._pathlist=tracer._pathlist.sort((a,b)=>Math.abs(b.area)-Math.abs(a.area)).slice(0,1);
 const transformed=new Set();for(const path of tracer._pathlist)for(const p of path.curve.c){if(p&&!transformed.has(p)){transformed.add(p);p.x=p.x/scale+x0;p.y=p.y/scale+y0;}}
 const tag=tracer.getPathTag('black'),d=tag.match(/d="([^"]*)"/)[1];return d?d+' Z ':'';
}

function fitContourUncached(path, settings){
 if(settings.geometry){const geometric=(settings.corners?geometricPolygon(path.points):'')||geometricCircle(path.points)||geometricEllipse(path.points)||geometricCapsule(path.points);if(geometric)return geometric;}
 const traced=potraceClosedContour(path);if(traced)return traced;
 if(settings.geometry){const seg=mixedFit(path.points,settings,true,true);if(seg)return mixedString(seg)+'Z ';}
 let pts=path.points.map(p=>[p.x,p.y]),n=pts.length;
 if(n<3)return '';
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of pts){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1])}const extent=Math.max(maxX-minX,maxY-minY);



 const level=settings.smooth, baseSigma=[0,.7,1.05,1.5,2.1,2.8][level], baseError=[.3,.55,.85,1.2,1.65,2.2][level];const sigma=Math.min(baseSigma,Math.max(.65,extent*.04)),error=Math.min(baseError,Math.max(.4,extent*.025));
 const k=Math.min(7,Math.floor(n/8)),candidates=[];
 if((settings.corners||extent<35)&&k>=3){for(let i=0;i<n;i++){
  const a=pts[(i-k+n)%n],b=pts[i],c=pts[(i+k)%n];
  const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1];
  const den=Math.hypot(ux,uy)*Math.hypot(vx,vy);if(!den)continue;
  const angle=Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/den)));
  if(angle>1.05)candidates.push({i,angle});
 }}
 candidates.sort((a,b)=>b.angle-a.angle);let anchors=[];
 for(const c of candidates){if(anchors.every(i=>Math.min(Math.abs(i-c.i),n-Math.abs(i-c.i))>k*2))anchors.push(c.i)}anchors.sort((a,b)=>a-b);
 const blur=(p,closed)=>{
  if(!sigma)return p;const r=Math.ceil(sigma*2.5),len=p.length;
  return p.map((v,i)=>{if(!closed&&(i===0||i===len-1))return v;
   // Linear extrapolation at anchored corners preserves straight edges.
   let x=0,y=0,weight=0;for(let j=-r;j<=r;j++){let t=i+j,z;
    if(closed)z=p[((t%len)+len)%len];else if(t<0)z=[p[0][0]+t*(p[1][0]-p[0][0]),p[0][1]+t*(p[1][1]-p[0][1])];else if(t>=len)z=[p[len-1][0]+(t-len+1)*(p[len-1][0]-p[len-2][0]),p[len-1][1]+(t-len+1)*(p[len-1][1]-p[len-2][1])];else z=p[t];
    const w=Math.exp(-j*j/(2*sigma*sigma));x+=z[0]*w;y+=z[1]*w;weight+=w;
   }return [x/weight,y/weight];
  });
 };
 let curves=[];
 if(anchors.length){
  for(let j=0;j<anchors.length;j++){const start=anchors[j],end=anchors[(j+1)%anchors.length];let span=[pts[start]];for(let i=(start+1)%n;i!==end;i=(i+1)%n)span.push(pts[i]);span.push(pts[end]);span=blur(span,false);curves.push(...fitCurve(span,error*error));}
 }else{
  pts=blur(pts,true);const tangent=fitCurve.createTangent(pts[1],pts[n-1]);curves=fitCurve.fitCubic([...pts,pts[0]],tangent,[-tangent[0],-tangent[1]],error*error);
 }
 if(!curves.length)return '';
 const margin=Math.max(3,extent*.25);const invalid=curves.some(c=>c.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])||p[0]<minX-margin||p[0]>maxX+margin||p[1]<minY-margin||p[1]>maxY+margin));
 if(invalid){const p=closedPolygon(path.points.map(p=>[p.x,p.y]),.35),f=p=>p.map(v=>+v.toFixed(3)).join(' ');return 'M '+f(p[0])+' '+p.slice(1).map(v=>'L '+f(v)).join(' ')+' Z ';}
 const fmt=p=>p.map(v=>+v.toFixed(3)).join(' ');
 return 'M '+fmt(curves[0][0])+' '+curves.map(c=>'C '+fmt(c[1])+' '+fmt(c[2])+' '+fmt(c[3])).join(' ')+' Z ';
}
function smoothSVG(img,pal,s,ow,oh){
 geometryCache=[];contourCache=new Map();seamUnderlay=new Map();seamSeen=new Set();
 const opt=ImageTracer.checkoptions({pal,colorquantcycles:1,mincolorratio:0,blurradius:0});
 const ii=ImageTracer.colorquantization(img,opt);
 // Conservative majority cleanup: remove isolated quantization specks.
 const clean=s.clean??2;const passes=clean>=3?2:clean>0?1:0;
 for(let pass=0;pass<passes;pass++){
  const src=ii.array,dst=src.map(row=>row.slice());
  for(let y=2;y<src.length-2;y++)for(let x=2;x<src[0].length-2;x++){
   const counts=new Map();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){let c=src[y+dy][x+dx];counts.set(c,(counts.get(c)||0)+1)}
   if((counts.get(src[y][x])||0)>(clean>=3?3:2))continue;
   let best=src[y][x],max=counts.get(best)||0;for(const [c,num]of counts)if(num>max&&pal[c]?.a){best=c;max=num}if(max>=(clean>=3?4:6)&&pal[src[y][x]]?.a)dst[y][x]=best;
  }ii.array=dst;
 }
 mergeToneIslands(ii,pal,clean);
 mergeFragments(ii,pal,clean);
 if(colorTraceSource)colorTraceSource.pal=pal;const layers=pal.map((c,i)=>c.a?ImageTracer.pathscan(ImageTracer.layeringstep(ii,i),s.noise).map(p=>{p.traceColor=c;return p;}):[]);
 postMessage({phase:'Menyambungkan batas warna…'});
 const fitted=sharedContours(layers,s);
 let body='';
 for(let c=0;c<pal.length;c++){
  if(!pal[c].a)continue;
  const paths=layers[c],ds=fitted[c],color='rgb('+pal[c].r+','+pal[c].g+','+pal[c].b+')';
  for(let i=0;i<paths.length;i++)if(!paths[i].isholepath&&ds[i]){
   let d=ds[i];for(const h of paths[i].holechildren)d+=ds[h]||'';
   body+='<path fill="'+color+'" fill-rule="evenodd" d="'+d+'"/>';
  }
 }
 // Satu path per warna; lebar 2 piksel layar di peramban (1 piksel ke tiap sisi sambungan), 2 satuan gambar di editor yang mengabaikan vector-effect.
 let under='';for(const [color,list] of seamUnderlay)under+='<path fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" d="'+list.join('')+'"/>';
 if(under)body='<g id="penutup-sambungan">'+under+'</g>'+body;
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+ow+'" height="'+oh+'" viewBox="0 0 '+img.width+' '+img.height+'">'+body+'</svg>';
}

// Select a bounded palette for the automatic color fallback using raster evidence.
// Explicit illustration settings still use the user's chosen color count.
function automaticPalette(d,minDistance){
 const hist=new Map();let total=0;
 for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;const key=((d[i]>>3)<<10)|((d[i+1]>>3)<<5)|(d[i+2]>>3);let b=hist.get(key);if(!b){b=[0,0,0,0];hist.set(key,b);}b[0]+=d[i];b[1]+=d[i+1];b[2]+=d[i+2];b[3]++;total++;}
 if(!total)return [];
 const bins=[...hist.values()].map(b=>({r:b[0]/b[3],g:b[1]/b[3],b:b[2]/b[3],n:b[3]}));
 let best=[];
 for(const count of [6,8,12,16]){
  const pal=paletteFor(d,count,minDistance);if(!pal.length)return pal;best=pal;let bad=0,accentLost=false;
  for(const b of bins){let error=Infinity;for(const p of pal)error=Math.min(error,(b.r-p.r)**2+(b.g-p.g)**2+(b.b-p.b)**2);
   if(error>24*24)bad+=b.n;
   if(b.n>=Math.max(4,total*.0005)&&error>36*36)accentLost=true;
  }
  if(bad/total<=.01&&!accentLost)break;
 }
 return best;
}

function paletteFor(d,count,minDistance=0){
 const hist=new Map();for(let i=0;i<d.length;i+=4){if(d[i+3]===0)continue;const k=((d[i]>>3)<<10)|((d[i+1]>>3)<<5)|(d[i+2]>>3);let e=hist.get(k);if(!e){e=[0,0,0,0];hist.set(k,e)}e[0]+=d[i];e[1]+=d[i+1];e[2]+=d[i+2];e[3]++}
 const bins=[...hist.values()].map(e=>[e[0]/e[3],e[1]/e[3],e[2]/e[3],e[3]]).sort((a,b)=>b[3]-a[3]);if(!bins.length)return [];
 const total=bins.reduce((n,b)=>n+b[3],0),dominant=bins.filter(b=>b[3]>=Math.max(4,total*.001));const seeds=dominant.reduce((n,b)=>n+b[3],0)>=total*.98?dominant:bins;
 const pal=[bins[0].slice(0,3)],dist=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
 while(pal.length<Math.min(count,seeds.length)){let score=-1,best=null;for(const b of seeds){const nearest=Math.min(...pal.map(p=>dist(b,p)));if(nearest<minDistance*minDistance)continue;const s=nearest*Math.sqrt(b[3]);if(s>score){score=s;best=b}}if(score<1||!best)break;pal.push(best.slice(0,3))}
 for(let iter=0;iter<6;iter++){const sums=pal.map(()=>[0,0,0,0]);for(const b of bins){let best=0,dd=Infinity;for(let j=0;j<pal.length;j++){let v=dist(b,pal[j]);if(v<dd){dd=v;best=j}}const s=sums[best];for(let j=0;j<3;j++)s[j]+=b[j]*b[3];s[3]+=b[3]}for(let j=0;j<pal.length;j++){if(sums[j][3])pal[j]=sums[j].slice(0,3).map(v=>v/sums[j][3])}}

 // Consolidate near-identical cluster centers after refinement, not just seeds.
 if(minDistance){const weights=pal.map(()=>0);for(const b of bins){let k=0,dd=Infinity;for(let j=0;j<pal.length;j++){const e=dist(b,pal[j]);if(e<dd){dd=e;k=j}}weights[k]+=b[3]}let changed=true;while(changed){changed=false;for(let i=0;i<pal.length&&!changed;i++)for(let j=i+1;j<pal.length;j++)if(dist(pal[i],pal[j])<26*26){const w=weights[i]+weights[j];pal[i]=pal[i].map((v,k)=>(v*weights[i]+pal[j][k]*weights[j])/(w||1));weights[i]=w;pal.splice(j,1);weights.splice(j,1);changed=true;break}}}
 return pal.map(p=>({r:Math.round(p[0]),g:Math.round(p[1]),b:Math.round(p[2]),a:255}));
}
// VektorKu V2 Pro raw-pixel adapter for node-potrace 2.1.8, 2026-10-01.
// Independent precision improvements for VektorKu V2 Pro, 2026-10-04.
// Reject a two-color approximation when a coherent off-palette accent exists.
function hasColorAccent(d,w,h,pal){
 const a=pal[0],b=pal[1]||{r:255,g:255,b:255},v=[b.r-a.r,b.g-a.g,b.b-a.b],den=v.reduce((n,z)=>n+z*z,0),bad=new Uint8Array(w*h);
 let count=0,total=0;
 for(let j=0;j<w*h;j++){const i=j*4;if(d[i+3]<128)continue;total++;const u=[d[i]-a.r,d[i+1]-a.g,d[i+2]-a.b],t=den?Math.max(-.35,Math.min(1.35,u.reduce((n,z,c)=>n+z*v[c],0)/den)):0;if(u.reduce((n,z,c)=>n+(z-t*v[c])**2,0)>28*28){bad[j]=1;count++;}}
 if(count>total*.045)return true;
 // Two-dimensional patches resist isolated compression noise; small accents matter.
 for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){const j=y*w+x;if(bad[j]&&bad[j+1]&&bad[j+w]&&bad[j+w+1])return true;}
 return false;
}
function precisionSample(d,w,h){
 const scale=Math.max(w,h)<=512?3:Math.max(w,h)<=1600?2:1;
 if(scale===1)return {data:d,width:w,height:h};
 const W=w*scale,H=h*scale,out=new Uint8ClampedArray(W*H*4);
 // Premultiplied interpolation avoids color bleeding from transparent RGB.
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const sx=(x+.5)/scale-.5,sy=(y+.5)/scale-.5,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
  let r=0,g=0,b=0,a=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const j=(Math.max(0,Math.min(h-1,iy+dy))*w+Math.max(0,Math.min(w-1,ix+dx)))*4,q=(dx?fx:1-fx)*(dy?fy:1-fy)*d[j+3]/255;a+=q;r+=q*d[j];g+=q*d[j+1];b+=q*d[j+2];}
  const i=(y*W+x)*4;if(a){out[i]=r/a;out[i+1]=g/a;out[i+2]=b/a;out[i+3]=a*255;}
 }
 return {data:out,width:W,height:H};
}


// ===== VektorKu V2 Pro 1.27, 2026-10-10: derau kompresi, warna interior, kontur subpiksel, susun bertumpuk =====
// Derau kompresi: variasi kecil pada jendela 5x5 yang seharusnya rata (jauh dari tepi tegas).
function compressionNoise(d,w,h){
 // Dibandingkan dengan jumlah jendela bertepi, agar tidak bergantung pada ukuran gambar.
 const step=Math.max(1,Math.floor(Math.max(w,h)/600));let edges=0,noisy=0;
 for(let y=2;y<h-2;y+=step)for(let x=2;x<w-2;x+=step){
  const i=(y*w+x)*4;if(d[i+3]<255)continue;let lo=255,hi=0,ok=true;
  for(let dy=-2;dy<=2&&ok;dy++)for(let dx=-2;dx<=2;dx++){const j=i+(dy*w+dx)*4;if(d[j+3]<255){ok=false;break;}const v=(d[j]+2*d[j+1]+d[j+2])>>2;if(v<lo)lo=v;if(v>hi)hi=v;}
  if(!ok)continue;if(hi-lo>24)edges++;else if(hi-lo>=3)noisy++;
 }
 return noisy/Math.max(edges,40);
}

// Warna palet diambil dari piksel interior yang rata, bukan rata-rata klaster yang
// tercampur piksel antialias. Tanpa interior (goresan tipis): ujung terjauh klaster.
function interiorPalette(d,w,h,pal,strict){
 const n=pal.length;if(!n||n>250)return pal;
 const labels=new Uint8Array(w*h).fill(255),count=new Uint32Array(n);
 for(let j=0,i=0;j<w*h;j++,i+=4){if(d[i+3]<250)continue;let best=Infinity,k=255;for(let q=0;q<n;q++){const p=pal[q];if(p.a===0)continue;const e=(d[i]-p.r)**2+(d[i+1]-p.g)**2+(d[i+2]-p.b)**2;if(e<best){best=e;k=q;}}labels[j]=k;if(k!==255)count[k]++;}
 const sum=pal.map(()=>[0,0,0,0]);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const j=y*w+x,k=labels[j];if(k===255)continue;const i=j*4;let flat=true;
  for(let dy=-1;dy<=1&&flat;dy++)for(let dx=-1;dx<=1;dx++){const q=j+dy*w+dx;if(labels[q]!==k){flat=false;break;}const z=q*4;if(Math.abs(d[z]-d[i])>10||Math.abs(d[z+1]-d[i+1])>10||Math.abs(d[z+2]-d[i+2])>10){flat=false;break;}}
  if(flat){const s=sum[k];s[0]+=d[i];s[1]+=d[i+1];s[2]+=d[i+2];s[3]++;}
 }
 const before=pal.map(p=>[p.r,p.g,p.b]);
 for(let k=0;k<n;k++){if(!count[k])continue;const s=sum[k];
  if(s[3]>=(strict?Math.max(12,count[k]*.25):6)){pal[k].r=Math.round(s[0]/s[3]);pal[k].g=Math.round(s[1]/s[3]);pal[k].b=Math.round(s[2]/s[3]);continue;}
  if(strict||n<2)continue;
  let o=[0,0,0],weight=0;for(let q=0;q<n;q++){if(q===k||!count[q])continue;for(let c=0;c<3;c++)o[c]+=before[q][c]*count[q];weight+=count[q];}if(!weight)continue;
  const u=before[k].map((v,c)=>v-o[c]/weight),len=Math.hypot(u[0],u[1],u[2]);if(len<8)continue;for(let c=0;c<3;c++)u[c]/=len;
  const hist=new Uint32Array(1024);
  for(let j=0;j<w*h;j++){if(labels[j]!==k)continue;const i=j*4;hist[Math.max(0,Math.min(1023,512+Math.round((d[i]-before[k][0])*u[0]+(d[i+1]-before[k][1])*u[1]+(d[i+2]-before[k][2])*u[2])))]++;}
  let need=Math.max(1,Math.round(count[k]*.15)),cut=1023;for(;cut>0;cut--){need-=hist[cut];if(need<=0)break;}
  const far=[0,0,0,0];
  for(let j=0;j<w*h;j++){if(labels[j]!==k)continue;const i=j*4;if(512+Math.round((d[i]-before[k][0])*u[0]+(d[i+1]-before[k][1])*u[1]+(d[i+2]-before[k][2])*u[2])<cut)continue;far[0]+=d[i];far[1]+=d[i+1];far[2]+=d[i+2];far[3]++;}
  if(far[3]){pal[k].r=Math.round(far[0]/far[3]);pal[k].g=Math.round(far[1]/far[3]);pal[k].b=Math.round(far[2]/far[3]);}
 }
 return pal;
}

// Campuran antialias dua warna bisa kebetulan mirip warna palet ketiga (kuning+biru ~ hijau) dan
// muncul sebagai pinggiran tipis berwarna salah. Untuk tiap piksel sumber dicatat warna palet
// yang masuk akal di sana: warna bidang rata di sekitarnya, ditambah warnanya sendiri bila ia
// bukan sekadar campuran dua warna tetangga (goresan tipis tetap diakui). 0 = tidak diketahui.
// Piksel yang warnanya hampir sama jauh dari dua warna palet (ambigu) dan berada di bidang rata
// tidak diputuskan sendiri-sendiri: labelnya menjalar dari piksel tetangga yang jelas warnanya.
// Hasilnya bidang gelap bertekstur halus menjadi satu warna utuh, dan gradasi terbelah rapi.
// Piksel ambigu di tepi atau garis tipis (kontras lokal tinggi) tetap memakai warna terdekatnya.
function coherentLabels(d,w,h,pal){
 const n=pal.length,N=w*h,first=new Uint8Array(N).fill(255),second=new Uint8Array(N).fill(255),grown=new Uint8Array(N).fill(255),floating=new Uint8Array(N),queue=new Int32Array(N);let end=0;
 for(let j=0,i=0;j<N;j++,i+=4){
  if(d[i+3]<128)continue;let best=Infinity,k=255,next=Infinity,k2=255;
  for(let q=0;q<n;q++){const p=pal[q],e=(d[i]-p.r)**2+(d[i+1]-p.g)**2+(d[i+2]-p.b)**2;if(e<best){next=best;k2=k;best=e;k=q;}else if(e<next){next=e;k2=q;}}
  first[j]=k;second[j]=k2;let sure=k2===255;
  if(!sure){const A=pal[k],B=pal[k2],gap=(A.r-B.r)**2+(A.g-B.g)**2+(A.b-B.b)**2;sure=!gap||.5+(next-best)/(2*gap)>=.68;}
  if(sure){grown[j]=k;queue[end++]=j;}else floating[j]=1;
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const j=y*w+x;if(!floating[j])continue;let flat=x>0&&y>0&&x<w-1&&y<h-1;
  if(flat){let lo0=255,lo1=255,lo2=255,hi0=0,hi1=0,hi2=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const z=(j+dy*w+dx)*4;if(d[z+3]<128){flat=false;continue;}if(d[z]<lo0)lo0=d[z];if(d[z]>hi0)hi0=d[z];if(d[z+1]<lo1)lo1=d[z+1];if(d[z+1]>hi1)hi1=d[z+1];if(d[z+2]<lo2)lo2=d[z+2];if(d[z+2]>hi2)hi2=d[z+2];}
   if(hi0-lo0>16||hi1-lo1>16||hi2-lo2>16)flat=false;}
  if(!flat){floating[j]=0;grown[j]=first[j];}}
 for(let read=0;read<end;read++){const p=queue[read],x=p%w,y=(p/w)|0,color=grown[p];
  for(const q of [x?p-1:-1,x<w-1?p+1:-1,y?p-w:-1,y<h-1?p+w:-1]){if(q<0||!floating[q]||grown[q]!==255||(first[q]!==color&&second[q]!==color))continue;grown[q]=color;queue[end++]=q;}}
 for(let j=0;j<N;j++)if(floating[j]&&grown[j]===255)grown[j]=first[j];
 // Bercak yang nyaris sewarna dengan sekelilingnya dan tidak dibatasi tepi yang nyata (tekstur halus
 // di dalam bidang gelap) dilebur ke warna di sekelilingnya. Bentuk bertepi tegas, misalnya huruf
 // samar, tidak disentuh, begitu juga bidang yang berbatasan dengan beberapa warna.
 const lab=pal.map(perceptualLab),seen=new Uint8Array(N),around=new Float64Array(n);
 for(let start=0;start<N;start++){
  const a=grown[start];if(a===255||seen[start])continue;let read=0;end=1;queue[0]=start;seen[start]=1;around.fill(0);let edges=0,crisp=0;
  while(read<end){const p=queue[read++],x=p%w,y=(p/w)|0;
   for(const step of [x?-1:0,x<w-1?1:0,y?-w:0,y<h-1?w:0]){if(!step)continue;const q=p+step,b=grown[q];if(b===a){if(!seen[q]){seen[q]=1;queue[end++]=q;}continue;}if(b===255)continue;
    around[b]++;edges++;const i=(p-step)*4,z=(q+step)*4,inside=p-step>=0&&p-step<N&&q+step>=0&&q+step<N&&Math.abs(((p-step)%w)-x)<=1&&Math.abs(((q+step)%w)-x)<=2;
    crisp+=inside?Math.sqrt((d[i]-d[z])**2+(d[i+1]-d[z+1])**2+(d[i+2]-d[z+2])**2):1e3;}}
  if(!edges)continue;let b=0;for(let q=1;q<n;q++)if(around[q]>around[b])b=q;if(around[b]<edges*.7)continue;
  const A=pal[a],B=pal[b],reference=Math.sqrt((A.r-B.r)**2+(A.g-B.g)**2+(A.b-B.b)**2)||1;
  if(Math.hypot(lab[a][0]-lab[b][0],lab[a][1]-lab[b][1],lab[a][2]-lab[b][2])<.075&&crisp/edges<.55*reference)for(let q=0;q<end;q++)grown[queue[q]]=b;
 }
 return grown;
}
function plausibleColors(d,w,h,pal,noisy,s){s=s||{};
 const n=pal.length,N=w*h,allow=new Uint32Array(N);if(n<3||n>31)return allow;
 // Piksel setengah transparan (sambungan bentuk pada PNG transparan) tetap diberi label; bidang rata harus opak.
 const label=coherentLabels(d,w,h,pal),core=new Uint8Array(N);
 const thick=1,around=noisy?4:2,spread=noisy?45*45:30*30;
 for(let y=thick;y<h-thick;y++)for(let x=thick;x<w-thick;x++){const j=y*w+x,k=label[j];if(k===255)continue;const i=j*4;let flat=true;
  for(let dy=-thick;dy<=thick&&flat;dy++)for(let dx=-thick;dx<=thick;dx++){const q=j+dy*w+dx,z=q*4;if(label[q]!==k||d[z+3]<250){flat=false;break;}if(Math.abs(d[z]-d[i])>10||Math.abs(d[z+1]-d[i+1])>10||Math.abs(d[z+2]-d[i+2])>10){flat=false;break;}}
  if(flat)core[j]=1;}
 const stats=pal.map(()=>({total:0,core:0,own:0}));allow.stats=stats;const rims=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const j=y*w+x,c=label[j];if(c===255)continue;let near=0;stats[c].total++;const i=j*4;
  if(core[j]){stats[c].core++;allow[j]=1<<c;continue;}
  // Arah gradien warna (kanal yang paling berubah); telusuri ke dua arah sampai bertemu bidang rata.
  let sides=0,found=0,GX=0,GY=0;
  if(x>0&&y>0&&x<w-1&&y<h-1){
   let gx=0,gy=0,strength=0;for(let k=0;k<3;k++){const ax=d[i+4+k]-d[i-4+k],ay=d[i+w*4+k]-d[i-w*4+k],z=Math.abs(ax)+Math.abs(ay);if(z>strength){strength=z;gx=ax;gy=ay;}}
   if(strength>=16){const len=Math.hypot(gx,gy);gx/=len;gy/=len;GX=gx;GY=gy;
    for(const sign of [1,-1])for(let t=1;t<=5;t++){const xx=Math.round(x+sign*gx*t),yy=Math.round(y+sign*gy*t);if(xx<0||yy<0||xx>=w||yy>=h)break;const q=yy*w+xx;if(label[q]===255)break;if(core[q]){sides|=1<<label[q];found++;break;}}}
  }
  if(found===2)near=sides;
  else for(let dy=-around;dy<=around;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;for(let dx=-around;dx<=around;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;const q=yy*w+xx;if(core[q])near|=1<<label[q];}}
  allow[j]=near;if(near>>c&1)continue;let mixed=false;
  search:for(let a=0;a<n;a++){if(!(near>>a&1))continue;for(let b=a+1;b<n;b++){if(!(near>>b&1))continue;
   const A=pal[a],B=pal[b],vx=B.r-A.r,vy=B.g-A.g,vz=B.b-A.b,ux=d[i]-A.r,uy=d[i+1]-A.g,uz=d[i+2]-A.b,t=(ux*vx+uy*vy+uz*vz)/(vx*vx+vy*vy+vz*vz||1);
   if(t>.08&&t<.92&&(ux-t*vx)**2+(uy-t*vy)**2+(uz-t*vz)**2<spread){
    // lebar zona peralihan searah gradien (dipakai untuk membedakan garis tepi tipis dari antialias)
    const YA=.299*A.r+.587*A.g+.114*A.b,YB=.299*B.r+.587*B.g+.114*B.b,YG=YB-YA,lum=z=>(.299*d[z]+.587*d[z+1]+.114*d[z+2]-YA)/YG,ti=Math.abs(YG)>=60?lum(i):-1;
    if(s.thinRim!==false&&(GX||GY)&&ti>.12&&ti<.88){let L=1;
     for(const sg of [1,-1])for(let st=1;st<=4;st++){const xx=Math.round(x+sg*GX*st),yy=Math.round(y+sg*GY*st);if(xx<0||yy<0||xx>=w||yy>=h)break;const q=yy*w+xx,z=q*4;if(core[q]||label[q]===255||d[z+3]<250)break;
      const tl=lum(z);if(!(tl>.08&&tl<.92))break;L++;}
     rims.push(j,c,L);}
    mixed=true;break search;}}}
  if(!mixed){allow[j]|=1<<c;stats[c].own++;}
 }
 // garis tepi tipis: zona peralihan lebih lebar daripada antialias biasa di gambar ini (median lebar + 1, minimal 2)
 if(rims.length){const Ls=[];for(let i=2;i<rims.length;i+=3)Ls.push(rims[i]);Ls.sort((a,b)=>a-b);const m=Ls[Ls.length>>1],need=Math.max(2,m+1);
  if(m<=2)for(let i=0;i<rims.length;i+=3)if(rims[i+2]>=need){const j=rims[i],c=rims[i+1];if(!(allow[j]>>c&1)){allow[j]|=1<<c;stats[c].own++;}}}
 return allow;
}
// Warna yang masuk akal pada posisi sampel bilinear (gabungan empat piksel sumber di sekitarnya).
function plausibleAt(allow,w,h,x,y){const ix=Math.max(0,Math.min(w-1,Math.floor(x))),iy=Math.max(0,Math.min(h-1,Math.floor(y))),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1);return (allow[iy*w+ix]|allow[iy*w+jx]|allow[jy*w+ix]|allow[jy*w+jx])||-1;}

// Medan cakupan ringkas: pemilik, pesaing terdekat, dan posisi di antara keduanya (0,5..1).
function newFieldSet(N,wide){const none=wide?65535:255;return {none,owner:new (wide?Uint16Array:Uint8Array)(N).fill(none),runner:new (wide?Uint16Array:Uint8Array)(N).fill(none),t:new Float32Array(N),alpha:new Uint8Array(N)};}
function fieldFor(set,k){const {owner,runner,t,alpha}=set;return j=>{if(owner[j]===k)return Math.min(alpha[j]/255,t[j]);if(runner[j]===k)return Math.min(alpha[j]/255,1-t[j]);return 0;};}

// Kontur subpiksel: tiap titik batas kisi digeser sepanjang normal ke posisi tepi yang
// diukur dari nilai antialias. Luas cakupan dipakai bila kedua sisi jenuh; selain itu
// perpotongan nilai 0,5. Titik tanpa tepi yang jelas (tepi gambar, tepi tumpukan) dibiarkan.
function subpixelPoints(path,field,W,H,scale,useArea){
 const pt=path.pt,n=pt.length;path.lattice=pt.map(p=>({x:p.x,y:p.y}));if(n<8||!field)return;
 const raw=path.lattice;
 const value=(x,y)=>{x=Math.max(0,Math.min(W-1,x-.5));y=Math.max(0,Math.min(H-1,y-.5));const ix=Math.min(W-2,Math.floor(x)),iy=Math.min(H-2,Math.floor(y)),fx=x-ix,fy=y-iy,j=iy*W+ix;return (field(j)*(1-fx)+field(j+1)*fx)*(1-fy)+(field(j+W)*(1-fx)+field(j+W+1)*fx)*fy;};
 if(W<2||H<2)return;
 const k=Math.max(2,Math.round(1.5*scale)),limit=1.25,reach=scale>1?1.5*scale+1:1.6,count=Math.max(8,Math.ceil(reach*4)),ds=2*reach/count,out=new Array(n);let sharpSum=0,sharpN=0;
 for(let i=0;i<n;i++){
  const p=raw[i],a=raw[(i-k+n)%n],b=raw[(i+k)%n];let nx=a.y-b.y,ny=b.x-a.x;const len=Math.hypot(nx,ny);out[i]=p;if(!len)continue;nx/=len;ny/=len;
  let inner=value(p.x-nx,p.y-ny),outer=value(p.x+nx,p.y+ny);if(inner<outer){nx=-nx;ny=-ny;const z=inner;inner=outer;outer=z;}
  if(inner-outer<.12)continue;
  sharpSum+=scale>1?Math.abs(value(p.x-nx*scale,p.y-ny*scale)-value(p.x+nx*scale,p.y+ny*scale)):inner-outer;sharpN++;
  // 1) perpotongan nilai 0,5 terdekat sepanjang normal (di dalam: cari ke luar; di luar: cari ke dalam)
  let shift=null,prevS=0,prevV=value(p.x,p.y)-.5;const sign=prevV>0?1:-1;
  for(let q=1;q<=5;q++){const s=sign*q*limit/5,v=value(p.x+nx*s,p.y+ny*s)-.5;if(v===0||(v>0)!==(prevV>0)){shift=prevS+(s-prevS)*(prevV/(prevV-v));break;}prevS=s;prevV=v;}
  if(shift===null||!Number.isFinite(shift))continue;
  // 2) posisi tepi dari luas cakupan pada jendela yang berpusat di perpotongan itu;
  //    jendela simetris tidak bias walau peralihan belum jenuh penuh.
  if(useArea){
   const v0=value(p.x+nx*(shift-reach),p.y+ny*(shift-reach)),v1=value(p.x+nx*(shift+reach),p.y+ny*(shift+reach));
   if(v0-v1>.6){let sum=0,prev=1,rise=0;for(let q=0;q<=count;q++){const s=shift-reach+q*ds,v=Math.max(0,Math.min(1,(value(p.x+nx*s,p.y+ny*s)-v1)/(v0-v1)));if(v>prev)rise+=v-prev;prev=v;sum+=(q===0||q===count?.5:1)*v;}
    const e=shift-reach+sum*ds;if(rise<.12&&Math.abs(e-shift)<=.5*scale&&Math.abs(e)<=limit)shift=e;}
  }
  out[i]={x:p.x+nx*shift,y:p.y+ny*shift};
 }
 for(let i=0;i<n;i++){pt[i].x=out[i].x;pt[i].y=out[i].y;}
 path.sharpness=sharpN?sharpSum/sharpN:1;if(self.__sh){self.__sh.s+=sharpSum;self.__sh.n+=sharpN;}
}

// Susun bertumpuk: lapisan besar di bawah, melebar sedikit di bawah lapisan di atasnya,
// sehingga sambungan antarwarna tidak menyisakan celah. Gambar opak memakai dasar persegi penuh.
function stackTrace(layers,label,W,H,scale,opaque,trace,crop){
 // label: indeks lapisan tiap piksel (-1 = kosong); diubah di tempat menjadi urutan tumpukan.
 const N=W*H,n=layers.length,area=new Float64Array(n);for(let j=0;j<N;j++){const l=label[j];if(l>=0)area[l]++;}
 leanCenters=[];leanHidden=leanClass=leanCover=leanOwn=null;let seeds=null;
 let order=[];for(let i=0;i<n;i++)if(area[i])order.push(i);order.sort((a,b)=>area[b]-area[a]);if(!order.length)return [];
 let full=-1;
 if(opaque){
  // Dasar persegi penuh: lapisan yang menutup seluruh tepi gambar bila ada, selain itu lapisan terluas.
  const first=label[0];let bordered=first>=0;for(let x=0;x<W&&bordered;x++)if(label[x]!==first||label[(H-1)*W+x]!==first)bordered=false;for(let y=0;y<H&&bordered;y++)if(label[y*W]!==first||label[y*W+W-1]!==first)bordered=false;
  if(bordered)order=[first,...order.filter(i=>i!==first)];
  full=order[0];
 }
 // Lapisan tinta. Pada gambar kartun bergaris hitam, garis tepi adalah lapisan gelap yang tipis tetapi tersebar luas.
 // Bila ditaruh di urutan luasnya, sebagian warna menumpuk di atas garis dan batas garis-warna ditentukan oleh kontur
 // warna. Ditaruh paling atas, garis menjadi satu bentuk utuh yang menentukan semua batasnya sendiri; warna di
 // bawahnya hanya perlu menyusup di bawah garis, dan bagian kontur warna yang tertutup garis boleh lebih sederhana.
 if(stackTrace.ink===true&&order.length>=3){let best=-1,bestA=0;
  for(const i of order){if(i===full)continue;const c=/rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(layers[i].color||'');if(!c)continue;
   if(.3*c[1]+.59*c[2]+.11*c[3]>(stackTrace.inkL??60)||area[i]<(stackTrace.inkShare??.02)*N)continue;
   let edge=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const j=y*W+x;if(label[j]!==i)continue;if((x&&label[j-1]!==i)||(x<W-1&&label[j+1]!==i)||(y&&label[j-W]!==i)||(y<H-1&&label[j+W]!==i))edge++;}
   const thick=2*area[i]/Math.max(1,edge);if(thick>(stackTrace.inkThick??7)*scale)continue;if(area[i]>bestA){bestA=area[i];best=i;}}
  if(best>=0&&order[order.length-1]!==best){order=order.filter(i=>i!==best);order.push(best);if(self.__ink)self.__ink.push([best,layers[best].color,bestA]);}}
 const rankOf=new Int16Array(n).fill(-1);order.forEach((i,r)=>{rankOf[i]=r;});
 const rank=label;for(let j=0;j<N;j++)if(rank[j]>=0)rank[j]=rankOf[rank[j]];
 const out=[],mask=new Uint8Array(N),queue=new Int32Array(N),reach=Math.max(2,Math.round(1.5*scale)),top=order.length-1,pad=reach+8+2*scale,box=crop?new Int32Array((top+1)*4):null;
 if(crop){for(let r=0;r<=top;r++){box[r*4]=W;box[r*4+1]=H;box[r*4+2]=-1;box[r*4+3]=-1;}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const r=rank[y*W+x];if(r<0)continue;const o=r*4;if(x<box[o])box[o]=x;if(y<box[o+1])box[o+1]=y;if(x>box[o+2])box[o+2]=x;if(y>box[o+3])box[o+3]=y;}}
 for(let r=0;r<=top;r++){
  const layer=layers[order[r]];
  if(order[r]===full){const z=trace(layer,null);if(z)out.push(z);continue;}
  let end=0;const X0=crop?Math.max(0,box[r*4]-pad):0,Y0=crop?Math.max(0,box[r*4+1]-pad):0,X1=crop?Math.min(W-1,box[r*4+2]+pad):W-1,Y1=crop?Math.min(H-1,box[r*4+3]+pad):H-1;
  const fill=r<top&&stackTrace.fill!==false;let free=0,sn=0;if(fill&&!seeds)seeds=new Int32Array(N);
  for(let y=Y0;y<=Y1;y++)for(let x=X0;x<=X1;x++){const j=y*W+x,v=rank[j];
   if(v!==r){mask[j]=0;if(fill&&v>r){free++;if((x===X0&&X0>0)||(x===X1&&X1<W-1)||(y===Y0&&Y0>0)||(y===Y1&&Y1<H-1)||(x&&rank[j-1]<r)||(x<W-1&&rank[j+1]<r)||(y&&rank[j-W]<r)||(y<H-1&&rank[j+W]<r))seeds[sn++]=j;}continue;}
   mask[j]=1;if(r<top&&((x&&rank[j-1]>r)||(x<W-1&&rank[j+1]>r)||(y&&rank[j-W]>r)||(y<H-1&&rank[j+W]>r)))queue[end++]=j;}
  const edge=end;
  // Lapisan bawah melebar sedikit di bawah lapisan di atasnya, tidak ke area kosong atau lapisan di bawahnya.
  let start=0;
  for(let step=0;step<reach&&start<end;step++){const stop=end,diagonal=step%2===1;
   for(let q=start;q<stop;q++){const j=queue[q],x=j%W,y=(j/W)|0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if((!dx&&!dy)||(dx&&dy&&!diagonal))continue;const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=W||yy>=H)continue;const z=yy*W+xx;if(mask[z]||rank[z]<=r)continue;mask[z]=1;queue[end++]=z;}
   }
   start=stop;
  }
  if(fill&&free){
   // "terbuka" = piksel lapisan atas yang tersambung (lewat piksel lapisan atas) ke lapisan di bawahnya, area kosong,
   // atau tepi kotak. Sisanya terkurung oleh lapisan ini sendiri: diisi.
   let qn=0;for(let q=0;q<sn;q++){const j=seeds[q];if(!mask[j]){mask[j]=2;seeds[qn++]=j;}}
   for(let q=0;q<qn;q++){const j=seeds[q],x=j%W,y=(j/W)|0;let z;
    if(x>X0&&!mask[z=j-1]&&rank[z]>r){mask[z]=2;seeds[qn++]=z;}if(x<X1&&!mask[z=j+1]&&rank[z]>r){mask[z]=2;seeds[qn++]=z;}
    if(y>Y0&&!mask[z=j-W]&&rank[z]>r){mask[z]=2;seeds[qn++]=z;}if(y<Y1&&!mask[z=j+W]&&rank[z]>r){mask[z]=2;seeds[qn++]=z;}}
   if(qn<free-(end-edge))for(let y=Y0;y<=Y1;y++)for(let x=X0;x<=X1;x++){const j=y*W+x;if(!mask[j]&&rank[j]>r)mask[j]=1;}
   for(let q=0;q<qn;q++)mask[seeds[q]]=0;
  }
  if(self.__st){for(let y=Y0;y<=Y1;y++)for(let x=X0;x<=X1;x++){const j=y*W+x;if(!mask[j])continue;for(const z of [x>0?j-1:-1,x<W-1?j+1:-1,y>0?j-W:-1,y<H-1?j+W:-1]){if(z<0||mask[z])continue;if(rank[z]>r){self.__st.hidden++;if(self.__st.map)self.__st.map[j]=Math.max(self.__st.map[j],2);}else{self.__st.open++;if(self.__st.map)self.__st.map[j]=Math.max(self.__st.map[j],1);}}}}
  // tepi tersembunyi: di sekitar titik itu hanya ada lapisan ini dan lapisan di atasnya
  leanHidden=r<top?(x,y)=>{const X=Math.round(x),Y=Math.round(y);if(X<2||Y<2||X>W-2||Y>H-2)return false;for(let yy=Y-2;yy<=Y+1;yy++)for(let xx=X-2;xx<=X+1;xx++)if(rank[yy*W+xx]<r)return false;return true;}:null;
  // kelas titik kisi: 0 = di antara piksel lapisan ini dan lapisan bawah/kosong (tepi asli yang terlihat), 2 = jauh di
  // bawah lapisan atas, 1 = selain itu (dekat sambungan). leanCover: piksel itu milik lapisan di atasnya (jadi apa pun yang digambar di sana tidak terlihat).
  leanClass=r<top?(X,Y)=>{let own=0,other=0,free=0;for(let dy=-1;dy<=0;dy++)for(let dx=-1;dx<=0;dx++){const x=X+dx,y=Y+dy;if(x<0||y<0||x>=W||y>=H){other++;continue;}const v=rank[y*W+x];if(v===r)own++;else if(v<r)other++;else free++;}
   return own&&other&&!free?0:leanHidden(X,Y)?2:1;}:null;
  leanCover=r<top?(x,y)=>{const X=Math.floor(x),Y=Math.floor(y);return X>=0&&Y>=0&&X<W&&Y<H&&rank[Y*W+X]>r;}:null;
  leanOwn=r<top?(x,y)=>{const X=Math.floor(x),Y=Math.floor(y);for(let yy=Math.max(0,Y-1);yy<=Math.min(H-1,Y+1);yy++)for(let xx=Math.max(0,X-1);xx<=Math.min(W-1,X+1);xx++)if(rank[yy*W+xx]===r)return true;return false;}:null;
  const z=trace(layer,mask,crop?{x:X0,y:Y0,w:X1-X0+1,h:Y1-Y0+1}:null);leanHidden=leanClass=leanCover=leanOwn=null;if(z)out.push(z);
 }
 return out;
}
// Sisi lurus: Potrace membengkokkan garis panjang di dekat lengkungan karena kurvanya
// membentang dari tengah sisi ke tengah sisi. Sisi yang terukur lurus (dari titik subpiksel)
// digabung dengan sisi segaris di sebelahnya, lalu diberi dua titik tambahan, sehingga bagian
// lurus tetap lurus dan lengkung hanya di ujungnya. Sudut antara dua garis = perpotongannya.
function straightenEdges(path,scale,sharp,tangent,tol=1){
 const curve=path.curve,m=curve.n,v=curve.vertex,pt=path.pt,n=pt.length,po=path.po;if(m<3||!path.lattice)return;
 const count=i=>(po[(i+1)%m]-po[i%m]+n)%n,length=i=>{const a=v[i%m],b=v[(i+1)%m];return Math.hypot(b.x-a.x,b.y-a.y);};
 // Garis kuadrat-terkecil melalui titik ke-(from..to) dihitung dari titik awal sisi `start`.
 function fit(start,from,to){
  const used=to-from+1;if(used<4)return null;let cx=0,cy=0;for(let c=from;c<=to;c++){const p=pt[(start+c)%n];cx+=p.x;cy+=p.y;}cx/=used;cy/=used;
  let xx=0,xy=0,yy=0;for(let c=from;c<=to;c++){const p=pt[(start+c)%n],x=p.x-cx,y=p.y-cy;xx+=x*x;xy+=x*y;yy+=y*y;}
  const angle=.5*Math.atan2(2*xy,xx-yy),ux=Math.cos(angle),uy=Math.sin(angle),q=[0,0,0,0],qn=[0,0,0,0];let sum=0,max=0;
  for(let c=from;c<=to;c++){const p=pt[(start+c)%n],d=(p.x-cx)*uy-(p.y-cy)*ux,g=Math.min(3,Math.floor((c-from)*4/used));q[g]+=d;qn[g]++;sum+=d*d;if(Math.abs(d)>max)max=Math.abs(d);}
  if(!qn.every(Boolean))return null;
  return {cx,cy,ux,uy,rms:Math.sqrt(sum/used),max,bow:Math.abs((q[0]/qn[0]+q[3]/qn[3]-q[1]/qn[1]-q[2]/qn[2])/2)};
 }
 const turn=i=>{i=((i%m)+m)%m;const a=v[(i-1+m)%m],b=v[i],c=v[(i+1)%m],x1=b.x-a.x,y1=b.y-a.y,x2=c.x-b.x,y2=c.y-b.y;return Math.atan2(x1*y2-y1*x2,x1*x2+y1*y2);};
 // Belokan total di titik sudut i, termasuk potongan sangat pendek di luarnya (sudut tumpul di raster).
 const bend=(i,dir)=>{let sum=turn(i),walked=0;for(let j=0;j<3;j++){walked+=length((((dir>0?i+j:i-1-j)%m)+m)%m);if(walked>2.5*scale+1)break;sum+=turn(dir>0?i+j+1:i-1-j);}return Math.abs(sum);};
 const minimum=Math.max(10,6*scale),order=[];for(let i=0;i<m;i++)if(length(i)>=minimum)order.push(i);order.sort((a,b)=>length(b)-length(a));
 // Ambang dalam piksel kisi; pada kisi yang diperbesar galat ukur per piksel kisi ikut membesar.
 const loose=Math.max(1,.6*scale)*tol,trim=Math.round(1.5*scale),taken=new Int32Array(m).fill(-1),runs=[],off=(p,l)=>Math.abs((p.x-l.cx)*l.uy-(p.y-l.cy)*l.ux);
 for(const i of order){
  if(taken[i]>=0)continue;const points=count(i),margin=Math.ceil(points*.12),line=fit(po[i],margin,points-margin);
  if(!line||points-2*margin<7||line.bow>=.035*loose||line.rms>=.1*loose||line.max>=.3*loose)continue;
  const run={s:i,k:1,line};
  for(const forward of [true,false]){
   while(run.k<m-1){
    const e=forward?(run.s+run.k)%m:(run.s-1+m)%m;if(taken[e]>=0)break;const c=count(e);let ok=true;
    // Titik di dekat sudut ikut membulat oleh antialias; beberapa titik terluar tidak diuji.
    if(c-trim<3)break;
    for(let j=forward?1:trim;j<=(forward?c-trim:c-1)&&ok;j++)if(off(pt[(po[e]+j)%n],run.line)>=.22*loose)ok=false;
    if(!ok)break;const s=forward?run.s:e;let total=0;for(let j=0;j<=run.k;j++)total+=count(s+j);
    const skip=Math.max(1,Math.min(trim,Math.floor(total*.12))),next=fit(po[s],skip,total-skip);if(!next||next.bow>=.035*loose||next.rms>=.1*loose||next.max>=.3*loose)break;
    run.s=s;run.k++;run.line=next;
   }
  }
  // Busur landai juga punya potongan pendek yang nyaris lurus. Terima hanya garis yang panjang,
  // atau sisi pendek yang diapit dua sudut nyata (sisi poligon, batang huruf).
  const a=v[run.s],b=v[(run.s+run.k)%m];
  if(Math.hypot(b.x-a.x,b.y-a.y)<45&&(bend(run.s,-1)<.4||bend(run.s+run.k,1)<.4))continue;
  for(let j=0;j<run.k;j++)taken[(run.s+j)%m]=runs.length;runs.push(run);
 }
 // Dua garis bersebelahan yang ternyata segaris dijadikan satu.
 for(let again=true;again;){again=false;
  for(const r of runs){if(r.dead)continue;const id=taken[(r.s+r.k)%m];if(id<0)continue;const q=runs[id];if(q===r||q.dead||q.s!==(r.s+r.k)%m||r.k+q.k>=m)continue;
   let total=0;for(let j=0;j<r.k+q.k;j++)total+=count(r.s+j);const skip=Math.max(1,Math.min(trim,Math.floor(total*.12))),line=fit(po[r.s],skip,total-skip);
   if(!line||line.bow>=.035*loose||line.rms>=.1*loose||line.max>=.3*loose)continue;
   for(let j=0;j<q.k;j++)taken[(q.s+j)%m]=taken[r.s];r.k+=q.k;r.line=line;q.dead=true;again=true;}
 }
 for(const r of runs){const a=v[r.s],b=v[(r.s+r.k)%m];if(r.line.ux*(b.x-a.x)+r.line.uy*(b.y-a.y)<0){r.line.ux=-r.line.ux;r.line.uy=-r.line.uy;}}
 const project=(p,l)=>{const t=(p.x-l.cx)*l.ux+(p.y-l.cy)*l.uy,z=p.copy();z.x=l.cx+t*l.ux;z.y=l.cy+t*l.uy;return z;};
 // Garis tiap sisi: garis lurus terkunci, atau garis singgung di puncak busur (dari parabola kuadrat-terkecil).
 const lines=new Array(m).fill(null);
 for(let i=0;i<m;i++){
  if(taken[i]>=0){lines[i]=runs[taken[i]].line;continue;}
  if(!tangent)continue;const c=count(i);if(c<6)continue;const skip=Math.max(1,Math.floor(c*.12)),l=fit(po[i],skip,c-skip);if(!l)continue;
  const a=v[i],b=v[(i+1)%m];if(l.ux*(b.x-a.x)+l.uy*(b.y-a.y)<0){l.ux=-l.ux;l.uy=-l.uy;}
  let m2=0,used=0;for(let q=skip;q<=c-skip;q++){const z=pt[(po[i]+q)%n],u=(z.x-l.cx)*l.ux+(z.y-l.cy)*l.uy;m2+=u*u;used++;}m2/=used;
  let num=0,den=0;for(let q=skip;q<=c-skip;q++){const z=pt[(po[i]+q)%n],u=(z.x-l.cx)*l.ux+(z.y-l.cy)*l.uy,e=(z.x-l.cx)*l.uy-(z.y-l.cy)*l.ux,w=u*u-m2;num+=e*w;den+=w*w;}
  const shift=Math.max(-.5,Math.min(.5,den?-num/den*m2:0));l.cx+=shift*l.uy;l.cy-=shift*l.ux;l.curved=true;lines[i]=l;
 }
 if(!runs.length&&!lines.some(Boolean))return;
 // Perpotongan dua garis lurus. Di raster, sudut tampak tumpul sejauh kira-kira satu piksel sumber
 // dibagi sinus setengah sudutnya; titik di dalam zona itu dianggap bagian dari sudut yang sama.
 const meet=(before,after,near)=>{
  const det=before.ux*after.uy-before.uy*after.ux;if(Math.abs(det)<=.14)return null;
  const dx=after.cx-before.cx,dy=after.cy-before.cy,t=(dx*after.uy-dy*after.ux)/det,x=before.cx+t*before.ux,y=before.cy+t*before.uy;
  const zone=1+scale/Math.max(.15,Math.sqrt(Math.max(0,1+before.ux*after.ux+before.uy*after.uy)/2));
  for(const p of near)if(Math.hypot(x-p.x,y-p.y)>zone&&off(p,before)>=.3&&off(p,after)>=.3)return null;
  const z=v[0].copy();z.x=x;z.y=y;if(sharp)z.sharp=true;return z;
 };
 // Dua garis yang hanya dipisahkan potongan pendek di zona sudut bertemu di satu titik sudut.
 const alias=new Map(),dropped=new Uint8Array(m);
 if(sharp)for(const r of runs){
  if(r.dead)continue;const e=(r.s+r.k)%m;if(taken[e]>=0)continue;let g=0;while(g<4&&taken[(e+g)%m]<0)g++;
  const id=taken[(e+g)%m];if(id<0||runs[id]===r||runs[id].s!==(e+g)%m)continue;
  const near=[];for(let j=0;j<g;j++){const c=count(e+j);for(let q=0;q<=c;q++)near.push(pt[(po[(e+j)%m]+q)%n]);}
  const z=meet(r.line,runs[id].line,near);if(!z)continue;
  alias.set(e,z);for(let j=1;j<=g;j++){alias.set((e+j)%m,z);dropped[(e+j)%m]=1;}
 }
 // Titik sudut i berada di antara sisi i-1 dan sisi i.
 function corner(i){
  i%=m;if(alias.has(i))return alias.get(i);
  const p=v[i],e=(i-1+m)%m,before=lines[e],after=lines[i],runBefore=taken[e]>=0,runAfter=taken[i]>=0;
  if(runBefore&&runAfter&&before!==after){const z=meet(before,after,[p]);if(z)return z;}
  if(before&&after&&before!==after){
   // Perpotongan dua garis sisi bila sudutnya cukup dan hasilnya tetap di dekat titik semula.
   const det=before.ux*after.uy-before.uy*after.ux;
   if(Math.abs(det)>.08){const dx=after.cx-before.cx,dy=after.cy-before.cy,t=(dx*after.uy-dy*after.ux)/det,z=p.copy();z.x=before.cx+t*before.ux;z.y=before.cy+t*before.uy;if(Math.hypot(z.x-p.x,z.y-p.y)<1)return z;}
   // Nyaris sejajar: titik ditarik ke garis lurus, atau ke tengah dua garis singgung.
   if(!runBefore&&!runAfter){const a=project(p,before),b=project(p,after),z=p.copy();z.x=(a.x+b.x)/2;z.y=(a.y+b.y)/2;return Math.hypot(z.x-p.x,z.y-p.y)<.75?z:p;}
  }
  const l=runBefore?before:runAfter?after:null;if(!l)return p;const z=project(p,l);return Math.hypot(z.x-p.x,z.y-p.y)<1.5?z:p;
 }
 const out=[],tight=Math.max(2,2*scale),firstRun=runs.find(r=>!r.dead);let i=firstRun?firstRun.s:0;
 for(let walked=0;walked<m;){
  const id=taken[i%m];
  if(id<0||runs[id].s!==i%m){if(!dropped[i%m])out.push(corner(i));i++;walked++;continue;}
  const r=runs[id],a=corner(r.s),b=corner(r.s+r.k),len=Math.hypot(b.x-a.x,b.y-a.y);if(!dropped[r.s])out.push(a);
  if(len>=6){
   const prev=(r.s-1+m)%m,next=(r.s+r.k)%m,d0=Math.min(len/3,taken[prev]>=0||alias.has(r.s)?tight:Math.max(2,length(prev))),d1=Math.min(len/3,taken[next]>=0||alias.has(next)?tight:Math.max(2,length(next)));
   const p0=a.copy(),p1=b.copy();p0.x=a.x+r.line.ux*d0;p0.y=a.y+r.line.uy*d0;p1.x=b.x-r.line.ux*d1;p1.y=b.y-r.line.uy*d1;const z0=project(p0,r.line),z1=project(p1,r.line);z0.flat=z1.flat=true;out.push(z0,z1);
  }
  i+=r.k;walked+=r.k;
 }
 if(out.length<3)return;
 path.curve=new curve.constructor(out.length);path.curve.vertex=out;
}
// Tulis kurva hasil; Bezier yang sebenarnya lurus ditulis sebagai garis dan garis segaris digabung.
function renderLogoCurve(curve){
 const c=curve.c,n=curve.n,pts=[],cmd=[];let prev=c[(n-1)*3+2];const start=prev;
 const line=z=>{const k=cmd.length-1;if(k>=0&&cmd[k].type==='L'){const o=cmd[k].from,q=cmd[k].p[0],dx=z.x-o.x,dy=z.y-o.y,len=Math.hypot(dx,dy)||1,along=((q.x-o.x)*dx+(q.y-o.y)*dy)/len;if(Math.abs((q.x-o.x)*dy-(q.y-o.y)*dx)/len<.01&&along>=0&&along<=len){cmd[k].p[0]=z;return;}}cmd.push({type:'L',from:prev,p:[z]});};
 for(let i=0;i<n;i++){
  const a=c[3*i],b=c[3*i+1],z=c[3*i+2];
  if(curve.tag[i]==='CORNER'){line(b);prev=b;line(z);}
  else{const dx=z.x-prev.x,dy=z.y-prev.y,len=Math.hypot(dx,dy)||1,off=q=>Math.abs((q.x-prev.x)*dy-(q.y-prev.y)*dx)/len,along=q=>((q.x-prev.x)*dx+(q.y-prev.y)*dy)/len;
   if(off(a)<.01&&off(b)<.01&&along(a)>=0&&along(b)<=len&&along(a)<=along(b))line(z);else cmd.push({type:'C',from:prev,p:[a,b,z]});}
  prev=z;
 }
 let begin=start;
 if(cmd.length>2&&cmd[0].type==='L'&&cmd[cmd.length-1].type==='L'){const o=cmd[cmd.length-1].from,z=cmd[0].p[0],dx=z.x-o.x,dy=z.y-o.y,len=Math.hypot(dx,dy)||1,along=((start.x-o.x)*dx+(start.y-o.y)*dy)/len;
  if(Math.abs((start.x-o.x)*dy-(start.y-o.y)*dx)/len<.01&&along>=0&&along<=len){begin=o;cmd.pop();}}
 const f=q=>+q.x.toFixed(2)+' '+ +q.y.toFixed(2);
 return 'M '+f(begin)+' '+cmd.map(k=>k.type+' '+k.p.map(f).join(' ')).join(' ');
}
// Parameter Potrace dari pengaturan: kehalusan -> alphaMax dan toleransi; detail kecil -> turdSize.
function logoTraceParams(s,scale){
 const smooth=Math.max(0,Math.min(5,s.smooth??2));
 return {alphaMax:smooth===0?0:s.corners===false?1.3334:[0,.7,1,1.1,1.2,1.3334][smooth],tolerance:[.5,.75,1,1.5,2.2,3][smooth],turdSize:Math.round((s.noise??0)/(s.sourceNoisy&&!s.twoTone?4:16)*scale*scale*(s.sizeFactor||1))};
}

// Dua warna: hampir semua piksel dekat salah satu dari dua warna yang sangat berbeda, atau di antara keduanya (antialias).
function twoToneShare(d,w,h){
 const pal=paletteFor(d,2);if(pal.length<2)return 0;const A=pal[0],B=pal[1];
 if(Math.max(Math.abs(B.r-A.r),Math.abs(B.g-A.g),Math.abs(B.b-A.b))<100)return 0;
 // hanya bidang rata (tetangga 2 px tidak berbeda > 14): tepi dan antialias tidak ikut dinilai
 let total=0,ok=0;const near=(i,P)=>(d[i]-P.r)**2+(d[i+1]-P.g)**2+(d[i+2]-P.b)**2<=40*40;
 for(let y=2;y<h-2;y+=2)for(let x=2;x<w-2;x+=2){const i=(y*w+x)*4;if(d[i+3]<250)continue;let flat=true;
  for(const o of [-2,2,-2*w,2*w]){const z=i+o*4;if(d[z+3]<250||Math.abs(d[z]-d[i])>14||Math.abs(d[z+1]-d[i+1])>14||Math.abs(d[z+2]-d[i+2])>14){flat=false;break;}}
  if(!flat)continue;total++;if(near(i,A)||near(i,B))ok++;}
 // warna ketiga dengan bidang rata sendiri (aksen kecil) membatalkan: sisa di luar dua warna harus nyaris nol
 twoToneShare.other=total-ok;twoToneShare.total=total;
 return total&&total-ok<=Math.max(12,total*.0015)?ok/total:0;
}
function monoCandidate(d,w,h,s,ow,oh){
 const pal=paletteFor(d,2);if(!pal.length)throw Error('Gambar tidak memiliki area terlihat.');
 if(s.mode!=='auto'&&s.mode!=='mono'&&s.mode!=='bw')return null;
 // Warna tinta sebenarnya dulu; rata-rata klaster yang pucat membuat tinta pekat tampak seperti warna lain.
 if(s.interior!==false)interiorPalette(d,w,h,pal,false);
 if(s.mode==='auto'&&hasColorAccent(d,w,h,pal))return null;
 // dua nada yang di mata sama -> satu tinta (noda halus di dalam huruf tidak menjadi bentuk sendiri)
 if(s.mode!=='bw'&&pal.length>1){const a=perceptualLab(pal[0]),b=perceptualLab(pal[1]);if(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<.04){let n0=0,n1=0;for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;const e0=(d[i]-pal[0].r)**2+(d[i+1]-pal[0].g)**2+(d[i+2]-pal[0].b)**2,e1=(d[i]-pal[1].r)**2+(d[i+1]-pal[1].g)**2+(d[i+2]-pal[1].b)**2;if(e0<=e1)n0++;else n1++;}pal.splice(n0>=n1?1:0,1);}}
 postMessage({phase:'Membentuk kurva logo dan tulisan…'});
 const inputWidth=w,sample=s.mode==='bw'&&Math.max(w,h)>1024?{data:d,width:w,height:h}:precisionSample(d,w,h);d=sample.data;w=sample.width;h=sample.height;const precisionScale=w/inputWidth,N=w*h;
 // Medan cakupan: posisi tiap piksel di antara dua warna (atau terhadap ambang hitam-putih).
 const set=newFieldSet(N),label=new Int16Array(N).fill(-1),first=pal[0],second=pal[1]||first,axis=[second.r-first.r,second.g-first.g,second.b-first.b],den=axis[0]*axis[0]+axis[1]*axis[1]+axis[2]*axis[2];let visible=0;
 for(let j=0,i=0;j<N;j++,i+=4){
  if(!d[i+3])continue;let t,k;
  if(s.mode==='bw'){t=.5+(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2]-s.threshold)/255;k=t>=.5?1:0;}
  else{t=den?Math.max(0,Math.min(1,((d[i]-first.r)*axis[0]+(d[i+1]-first.g)*axis[1]+(d[i+2]-first.b)*axis[2])/den)):0;k=t>.5?1:0;}
  const white=s.removeWhite&&d[i]>=s.whiteLevel&&d[i+1]>=s.whiteLevel&&d[i+2]>=s.whiteLevel;
  set.owner[j]=k;set.runner[j]=1-k;set.t[j]=k?t:1-t;set.alpha[j]=white?0:d[i+3];
  if(d[i+3]<128||white)continue;label[j]=k;visible++;
 }
 if(!visible)throw Error('Tidak ada bentuk tersisa. Matikan penghapus putih.');
 const colors=s.mode==='bw'?[{r:0,g:0,b:0},{r:255,g:255,b:255}]:pal;
 function make(layer,mask,tol){return preciseLogoPath(mask,w,h,precisionScale,layer.color,{...s,refineMono:true},tol,s.subpixel===false?null:layer.field); }
 // Compare rendered candidates, including enclosed holes, before stronger reduction.
 function raster(path){const cv=new OffscreenCanvas(w,h),cx=cv.getContext('2d',{willReadFrequently:true});const str=path.match(/d="([^"]*)"/)[1];cx.fill(new Path2D(str),'evenodd');const rgba=cx.getImageData(0,0,w,h).data,m=new Uint8Array(w*h);for(let i=0;i<m.length;i++)m[i]=rgba[4*i+3]>=128?1:0;return m;}
 function topology(a){const seen=new Uint8Array(a.length),q=new Int32Array(a.length);let components=0,holes=0;for(let j=0;j<a.length;j++){if(seen[j])continue;const value=a[j];let read=0,end=1,border=false;q[0]=j;seen[j]=1;while(read<end){const k=q[read++],x=k%w,y=(k/w)|0;if(x===0||y===0||x===w-1||y===h-1)border=true;for(const n of [x?k-1:-1,x<w-1?k+1:-1,y?k-w:-1,y<h-1?k+w:-1])if(n>=0&&!seen[n]&&a[n]===value){seen[n]=1;q[end++]=n;}}if(value)components++;else if(!border)holes++;}return components+','+holes;}
 let rejected=false;
 const layers=[0,1].map(k=>{const p=colors[k]||colors[0];return {field:fieldFor(set,k),color:`rgb(${p.r},${p.g},${p.b})`};});
 // Lapisan dasar menjadi persegi penuh pada gambar opak; lapisan lain ditumpuk di atasnya.
 const paths=stackTrace(layers,label,w,h,precisionScale,visible===N&&!s.removeWhite,(layer,mask)=>{
  if(!mask)return `<path fill="${layer.color}" d="M0 0 L${w} 0 L${w} ${h} L0 ${h} Z"/>`;
  let path=make(layer,mask,.2);
  if(s.quality==='simple'&&typeof OffscreenCanvas!=='undefined'&&typeof Path2D!=='undefined'){const simpler=make(layer,mask,.5),base=raster(path),candidate=raster(simpler);let diff=0,area=0;for(let i=0;i<base.length;i++){area+=base[i];diff+=base[i]!==candidate[i]?1:0;}if(diff<=Math.max(4,area*.008)&&topology(base)===topology(candidate))path=simpler;else rejected=true;}
  return /d="\s*"/.test(path)?'':path;
 });
 if(!paths.length)throw Error('Tidak ada bentuk tersisa setelah tracing.');
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${w} ${h}">${paths.join('')}</svg>`,engine:s.mode==='bw'?'Hitam-putih':'Logo satu warna',note:rejected?' Sebagian detail dipertahankan agar bentuk tidak berubah.':''};
}

// Offline tracing for textured print illustrations. Keep subpaths and their holes.
function textureCandidate(input,w,h,s,ow,oh){
 const d=new Uint8ClampedArray(input),clean=s.texture==='clean',balanced=s.texture==='balanced';
 for(let i=0;i<d.length;i+=4)if(d[i+3]<128||(s.removeWhite&&d[i]>=s.whiteLevel&&d[i+1]>=s.whiteLevel&&d[i+2]>=s.whiteLevel))d[i+3]=0;
 postMessage({phase:'Mengenali warna ilustrasi bertekstur…'});
 const pal=paletteFor(d,clean?8:6,24);
 // Remove intermediate antialias colors lying between other ink colors.
 let pruning=clean;while(pruning&&pal.length>2){pruning=false;let best=-1,error=18*18;for(let k=0;k<pal.length;k++)for(let a=0;a<pal.length;a++)for(let b=a+1;b<pal.length;b++){if(k===a||k===b)continue;const A=pal[a],B=pal[b],P=pal[k],v=[B.r-A.r,B.g-A.g,B.b-A.b],u=[P.r-A.r,P.g-A.g,P.b-A.b],den=v.reduce((n,x)=>n+x*x,0),t=u.reduce((n,x,i)=>n+x*v[i],0)/den;if(t<.04||t>.96)continue;const e=u.reduce((n,x,i)=>n+(x-t*v[i])**2,0);if(e<error){error=e;best=k;}}if(best>=0){pal.splice(best,1);pruning=true;}}if(!pal.length)throw Error('Tidak ada area terlihat.');
 let labels=new Uint8Array(w*h);labels.fill(255);const cache=new Map();
 for(let i=0;i<labels.length;i++){const j=i*4;if(!d[j+3])continue;const key=(d[j]<<16)|(d[j+1]<<8)|d[j+2];let k=cache.get(key);if(k===undefined){let best=Infinity;for(let n=0;n<pal.length;n++){const p=pal[n],err=(d[j]-p.r)**2+(d[j+1]-p.g)**2+(d[j+2]-p.b)**2+2*((d[j]-d[j+1])-(p.r-p.g))**2+2*((d[j+1]-d[j+2])-(p.g-p.b))**2;if(err<best){best=err;k=n;}}cache.set(key,k);}labels[i]=k;}
 if(clean){
  // Categorical majority suppresses halftone dots without blending ink colors.
  const radius=Math.max(2,Math.round(Math.max(w,h)/400));
  for(let pass=0;pass<2;pass++){const out=labels.slice(),counts=new Uint16Array(pal.length);for(let y=0;y<h;y++){if(y%256===0)postMessage({phase:'Mengurangi tekstur · '+Math.round((pass+y/h)*50)+'%'});for(let x=0;x<w;x++){const i=y*w+x;if(labels[i]===255)continue;counts.fill(0);for(let dy=-radius;dy<=radius;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;for(let dx=-radius;dx<=radius;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;const k=labels[yy*w+xx];if(k!==255)counts[k]++;}}let best=labels[i];for(let k=0;k<counts.length;k++)if(counts[k]>counts[best])best=k;out[i]=best;}}labels=out;}
 }
 const paths=[];let background=-1;
 for(let k=0;k<pal.length;k++){let full=true;for(let x=0;x<w&&full;x++)if(labels[x]!==k||labels[(h-1)*w+x]!==k)full=false;for(let y=0;y<h&&full;y++)if(labels[y*w]!==k||labels[y*w+w-1]!==k)full=false;if(full){background=k;break;}}
 const color=k=>`rgb(${pal[k].r},${pal[k].g},${pal[k].b})`;
 if(background>=0)paths.push(`<path fill="${color(background)}" d="M0 0 L${w} 0 L${w} ${h} L0 ${h} Z"/>`);
 for(let k=0;k<pal.length;k++){if(k===background)continue;postMessage({phase:'Menelusuri tekstur · warna '+(k+1)+'/'+pal.length});const bm=new PotraceBrowser.Bitmap(w,h);for(let i=0;i<labels.length;i++)bm.data[i]=labels[i]===k?0:255;
  const t=new PotraceBrowser.Potrace({threshold:128,turdSize:clean?Math.max(2,Math.round(w*h/150000)):(balanced?2:0),alphaMax:1,optCurve:true,optTolerance:clean?.35:(balanced?.4:.2)});t._luminanceData=bm;t._imageLoaded=true;const path=t.getPathTag(color(k));if(!/d="\s*"/.test(path))paths.push(path);
 }
 if(!paths.length)throw Error('Tidak ada bentuk tersisa.');
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${w} ${h}">${paths.join('')}</svg>`,engine:clean?'Tekstur dikurangi':balanced?'Tekstur seimbang':'Tekstur dipertahankan',note:clean?' Detail kecil dapat hilang.':balanced?' Bintik terkecil disederhanakan.':' Tekstur rinci membutuhkan banyak titik.'};
}

// Lossless serialization for generated absolute SVG paths: no coordinate rounding.
function compactVectorSVG(svg){
 return svg.replace(/\bd="([^"]*)"/g,(_,d)=>{
  const tokens=d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[];
  let result='',numberBefore=false;
  for(const token of tokens){if(/^[a-zA-Z]$/.test(token)){result+=token;numberBefore=false;}else{const value=Number(token);if(!Number.isFinite(value))throw Error('Koordinat SVG tidak valid.');const text=String(value);result+=(numberBefore&&text[0]!=='-'?' ':'')+text;numberBefore=true;}}
  return 'd="'+result+'"';
 });
}

const sendVectorMessage=postMessage.bind(self);postMessage=(message)=>{if(message.phase&&message.stage===undefined)message.stage=/Menelusuri|Membentuk|Menjaga|Menyambungkan/.test(message.phase)?2:1;if(message.svg){message.svg=compactVectorSVG(message.svg);message.note=(message.note||'')+backgroundRemovalNote;message.noisy=lastNoisy;message.stage=3;}sendVectorMessage(message);};
// Resolve isolated pale ink components against a uniform opaque light background.
function paleLogoMasks(d,w,h,pal,scale,allow,noisy){
 const bg=pal[0];if(Math.min(bg.r,bg.g,bg.b)<225)return null;
 for(let i=3;i<d.length;i+=4)if(d[i]<255)return null;
 let edge=0,matching=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!x||!y||x===w-1||y===h-1){edge++;const i=(y*w+x)*4;if((d[i]-bg.r)**2+(d[i+1]-bg.g)**2+(d[i+2]-bg.b)**2<24*24)matching++;}if(matching/edge<.94)return null;
 // Tiap piksel menyimpan satu tinta terbaik dan kadarnya, bukan satu medan per tinta: memori tetap walau warnanya banyak.
 const W=w*scale,H=h*scale,N=W*H,inkOf=new Uint8Array(N).fill(255),amount=new Float32Array(N),bridge=new Uint8Array(N),bridgeList=[],between=newFieldSet(N);
 const vectors=pal.slice(1).map(p=>[p.r-bg.r,p.g-bg.g,p.b-bg.b]),lengths=vectors.map(v=>v[0]*v[0]+v[1]*v[1]+v[2]*v[2]||1),inks=vectors.length;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const xx=(x+.5)/scale-.5,yy=(y+.5)/scale-.5,ix=Math.floor(xx),iy=Math.floor(yy),fx=xx-ix,fy=yy-iy;let p0=0,p1=0,p2=0;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=(Math.max(0,Math.min(h-1,iy+dy))*w+Math.max(0,Math.min(w-1,ix+dx)))*4,a=(dx?fx:1-fx)*(dy?fy:1-fy);p0+=d[i]*a;p1+=d[i+1]*a;p2+=d[i+2]*a;}
  const u0=p0-bg.r,u1=p1-bg.g,u2=p2-bg.b,q=y*W+x,can=allow?plausibleAt(allow,w,h,xx,yy):-1;
  // Tinta yang garis latar->tinta-nya paling menjelaskan piksel ini; sekaligus warna terdekat dan
  // pesaingnya (0 = latar, j+1 = tinta j) untuk batas antara dua tinta.
  let best=24*24,k=-1,t=0,d0=can&1?u0*u0+u1*u1+u2*u2:Infinity,own=can&1?0:255,d1=Infinity,rival=255;
  for(let j=0;j<inks;j++){if(!(can>>(j+1)&1))continue;const v=vectors[j],a=Math.max(0,Math.min(1,(u0*v[0]+u1*v[1]+u2*v[2])/lengths[j])),err=(u0-a*v[0])**2+(u1-a*v[1])**2+(u2-a*v[2])**2;if(a>.15&&err<best){best=err;k=j;t=a;}
   const e=(u0-v[0])**2+(u1-v[1])**2+(u2-v[2])**2;if(e<d0){d1=d0;rival=own;d0=e;own=j+1;}else if(e<d1){d1=e;rival=j+1;}}
  if(k>=0){inkOf[q]=k;amount[q]=t;}
  const A=own&&own!==255?vectors[own-1]:null,B=rival===255?A:rival?vectors[rival-1]:null,gap=((A?A[0]:0)-(B?B[0]:0))**2+((A?A[1]:0)-(B?B[1]:0))**2+((A?A[2]:0)-(B?B[2]:0))**2;
  between.owner[q]=own;between.runner[q]=rival;between.t[q]=gap&&rival!==255?Math.min(1,.5+(d1-d0)/(2*gap)):1;
  // Piksel campuran dua tinta yang tidak diakui medan mana pun: masuk ke tinta terdekatnya.
  if(k<0&&own>0&&own!==255){bridge[q]=own;bridgeList.push(q);}
 }
 const layers=[],index=new Map(),queue=new Int32Array(N),seen=new Uint8Array(N),label=new Int16Array(N).fill(-1),histogram=new Uint32Array(101);
 for(let i=0;i<N;i++){
  const k=inkOf[i];if(k===255||seen[i]||amount[i]<=.15)continue;let read=0,end=1,peak=0;histogram.fill(0);seen[i]=1;queue[0]=i;
  while(read<end){const j=queue[read++],x=j%W,y=(j/W)|0;histogram[Math.min(100,Math.round(amount[j]*100))]++;for(const n of [x?j-1:-1,x<W-1?j+1:-1,y?j-W:-1,y<H-1?j+W:-1])if(n>=0&&!seen[n]&&inkOf[n]===k&&amount[n]>.15){seen[n]=1;queue[end++]=n;}}
  let accumulated=0;for(let bin=0;bin<=100;bin++){accumulated+=histogram[bin];if(accumulated>=end*.9){peak=bin/100;break;}}
  // Strongly covered samples can be sparse on thin dark outlines.
  // Require multiple source-pixel equivalents, not one noisy maximum.
  let strong=0;for(let bin=90;bin<=100;bin++)strong+=histogram[bin];
  const supportedDark=peak<.85&&strong>=Math.max(2*scale*scale,Math.ceil(end*.005));
  const tone=supportedDark||peak>=.85?1:Math.max(.2,Math.round(peak*10)/10),threshold=peak*.5;
  // Pada gambar berartefak kompresi, bercak pucat kecil di sekitar bentuk adalah riak, bukan tinta.
  if(noisy&&tone<1&&(end<80*scale*scale||peak<.3))continue;
  const id=k*16+Math.round(tone*10);let li=index.get(id);
  if(li===undefined){li=layers.length;index.set(id,li);const v=vectors[k];layers.push({ink:k,field:j=>bridge[j]?(between.owner[j]===k+1?between.t[j]:between.runner[j]===k+1?1-between.t[j]:0):(inkOf[j]===k?Math.min(1,amount[j]):0),color:`rgb(${Math.round(bg.r+tone*v[0])},${Math.round(bg.g+tone*v[1])},${Math.round(bg.b+tone*v[2])})`});}
  for(let q=0;q<end;q++){const j=queue[q];if(amount[j]>=threshold)label[j]=li;amount[j]=amount[j]/(2*threshold);}
 }
 // Celah antialias di antara dua tinta diisi: dulu oleh lapisan bertinta sama (batas tepat di
 // tengah campuran warna), sisanya oleh lapisan tetangga mana pun, supaya lapisan bertemu.
 if(bridgeList.length&&layers.length>1){
  let open=bridgeList;
  for(const same of [true,false])for(let pass=0;pass<3*scale+3&&open.length;pass++){const next=[],claim=[];
   for(const j of open){const x=j%W,y=(j/W)|0;let pick=-1;for(const q of [x?j-1:-1,x<W-1?j+1:-1,y?j-W:-1,y<H-1?j+W:-1]){if(q<0||label[q]<0)continue;if(layers[label[q]].ink===bridge[j]-1){pick=label[q];break;}if(!same&&pick<0)pick=label[q];}
    if(pick>=0)claim.push(j,pick);else next.push(j);}
   for(let c=0;c<claim.length;c+=2)label[claim[c]]=claim[c+1];
   open=next;if(!claim.length)break;}
 }
 return {W,H,bg,layers,label};
}

// Palet logo: jumlah warna dinaikkan sampai tidak ada warna bidang rata yang tertinggal.
function logoPalette(d,w,h,flatPeaks){
 const bins=new Map();let total=0;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4;if(d[i+3]<250)continue;total++;let flat=true;
  for(let dy=-1;dy<=1&&flat;dy++)for(let dx=-1;dx<=1;dx++){const z=i+(dy*w+dx)*4;if(d[z+3]<250||Math.abs(d[z]-d[i])>10||Math.abs(d[z+1]-d[i+1])>10||Math.abs(d[z+2]-d[i+2])>10){flat=false;break;}}
  if(!flat)continue;const key=((d[i]>>3)<<10)|((d[i+1]>>3)<<5)|(d[i+2]>>3);let b=bins.get(key);if(!b){b=[0,0,0,0];bins.set(key,b);}b[0]+=d[i];b[1]+=d[i+1];b[2]+=d[i+2];b[3]++;}
 const solid=[...bins.values()].map(b=>[b[0]/b[3],b[1]/b[3],b[2]/b[3],b[3]]);let pal=[];
 for(const count of [8,12,16,24]){pal=paletteFor(d,count,24);if(!pal.length)break;let missing=0;for(const b of solid){let e=Infinity;for(const p of pal){const v=(b[0]-p.r)**2+(b[1]-p.g)**2+(b[2]-p.b)**2;if(v<e)e=v;}if(e>24*24)missing+=b[3];}if(missing<Math.max(12,total*.0005))break;}
 if(flatPeaks!==false&&pal.length){const need=Math.max(150,total*.0003),big=solid.filter(b=>b[3]>=need).sort((a,b)=>b[3]-a[3]);
  for(const b of big){if(pal.length>=28)break;let e=Infinity;for(const p of pal){const v=(b[0]-p.r)**2+(b[1]-p.g)**2+(b[2]-p.b)**2;if(v<e)e=v;}if(e<=12*12)continue;
   let core=0,ring=0,r=0,g=0,bl=0;for(const o of solid){const v=(b[0]-o[0])**2+(b[1]-o[1])**2+(b[2]-o[2])**2;if(v<=36){core+=o[3];r+=o[0]*o[3];g+=o[1]*o[3];bl+=o[2]*o[3];}else if(v<=144)ring+=o[3];}
   if(core>=need&&ring<.6*core)pal.push({r:Math.round(r/core),g:Math.round(g/core),b:Math.round(bl/core),a:255,peak:true});}}
 return pal;
}
// Jarak warna perseptual: OKLab dengan sedikit cahaya dasar, karena pada layar bernada terang
// perbedaan antar-nada sangat gelap nyaris tak terlihat (hitam vs hitam kebiruan).
function perceptualLab(p){
 const f=v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);},R=f(p.r),G=f(p.g),B=f(p.b),e=.02;
 const l=Math.cbrt(.4122214708*R+.5363325363*G+.0514459929*B+e),m=Math.cbrt(.2119034982*R+.6806995451*G+.1073969566*B+e),s=Math.cbrt(.0883024619*R+.2817188376*G+.6299787005*B+e);
 return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
}
// Warna palet yang nyaris tak terbedakan oleh mata digabung ke warna yang lebih luas,
// supaya bidang gelap tidak belang oleh dua nada hitam.
function mergeDarkTwins(d,w,h,pal){
 for(let round=0;round<8&&pal.length>1;round++){
  const lab=pal.map(perceptualLab);let pick=null,nearest=.04;
  for(let a=0;a<pal.length;a++)for(let b=a+1;b<pal.length;b++){if(pal[a].forced||pal[b].forced||Math.max(lab[a][0],lab[b][0])>.345)continue;const e=Math.hypot(lab[a][0]-lab[b][0],lab[a][1]-lab[b][1],lab[a][2]-lab[b][2]);if(e<nearest){nearest=e;pick=[a,b];}}
  if(!pick)break;const count=[0,0],A=pal[pick[0]],B=pal[pick[1]];
  for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;const ea=(d[i]-A.r)**2+(d[i+1]-A.g)**2+(d[i+2]-A.b)**2,eb=(d[i]-B.r)**2+(d[i+1]-B.g)**2+(d[i+2]-B.b)**2;if(Math.min(ea,eb)>40*40)continue;count[ea<=eb?0:1]++;}
  pal.splice(count[0]>=count[1]?pick[1]:pick[0],1);
 }
 return pal;
}
function mergeLookalikeColors(d,w,h,pal){
 for(let round=0;round<12&&pal.length>2;round++){
  const n=pal.length,count=new Float64Array(n);
  for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;let best=Infinity,k=0;for(let q=0;q<n;q++){const p=pal[q],e=(d[i]-p.r)**2+(d[i+1]-p.g)**2+(d[i+2]-p.b)**2;if(e<best){best=e;k=q;}}count[k]++;}
  const lab=pal.map(perceptualLab);let pick=null,nearest=.04;
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++){const e=Math.hypot(lab[a][0]-lab[b][0],lab[a][1]-lab[b][1],lab[a][2]-lab[b][2]);if(e<nearest){nearest=e;pick=[a,b];}}
  if(!pick)break;pal.splice(count[pick[0]]>=count[pick[1]]?pick[1]:pick[0],1);
 }
 return pal;
}
// Gradasi dan foto: batas antarwarna palet kebanyakan "lunak" (dua piksel bertetangga nyaris sama).
// Gambar datar: batas warna jatuh pada tepi yang nyata.
function softBoundaryShare(d,w,h,pal){
 const N=w*h,label=new Uint8Array(N).fill(255),n=pal.length;
 for(let j=0,i=0;j<N;j++,i+=4){if(d[i+3]<128)continue;let best=Infinity,k=255;for(let q=0;q<n;q++){const p=pal[q],e=(d[i]-p.r)**2+(d[i+1]-p.g)**2+(d[i+2]-p.b)**2;if(e<best){best=e;k=q;}}label[j]=k;}
 let soft=0,hard=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const j=y*w+x,a=label[j];if(a===255)continue;const i=j*4;
  for(const q of [x<w-1?j+1:-1,y<h-1?j+w:-1]){if(q<0)continue;const b=label[q];if(b===255||b===a)continue;const z=q*4;if(Math.max(Math.abs(d[i]-d[z]),Math.abs(d[i+1]-d[z+1]),Math.abs(d[i+2]-d[z+2]))<12)soft++;else hard++;}}
 return soft/Math.max(1,soft+hard);
}

// Flat colored logos: discard intermediate antialias colors, retain whole masks.
// Distinguish a flat interior color from an antialias mixture before palette pruning.
function logoInteriorColors(d,w,h,pal){
 const labels=new Int16Array(w*h);labels.fill(-1);const counts=new Uint32Array(pal.length);
 for(let i=0;i<labels.length;i++){if(d[4*i+3]<250)continue;let best=10*10,k=-1;
  for(let j=0;j<pal.length;j++){const p=pal[j],e=(d[4*i]-p.r)**2+(d[4*i+1]-p.g)**2+(d[4*i+2]-p.b)**2;if(e<best){best=e;k=j;}}labels[i]=k;
 }
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,k=labels[i];if(k<0)continue;
  if(labels[i-1]===k&&labels[i+1]===k&&labels[i-w]===k&&labels[i+w]===k&&labels[i-w-1]===k&&labels[i-w+1]===k&&labels[i+w-1]===k&&labels[i+w+1]===k)counts[k]++;
 }
 return new Set(pal.filter((p,k)=>counts[k]>=2));
}
// Fit separate contours conservatively: small holes and glyphs get a tighter
// optimization budget. Polygon recognition is restricted to well-supported edges.
// Approximate symmetric distance to the measured contour, in tracing coordinates.
function logoCurveSamples(curve){
 const out=[],c=curve.c;let prev=c[c.length-1];
 for(let i=0;i<curve.n;i++){
  const a=c[i*3],b=c[i*3+1],z=c[i*3+2];
  if(curve.tag[i]==='CORNER'){out.push([prev.x,prev.y],[b.x,b.y],[z.x,z.y]);}
  else {const length=Math.hypot(a.x-prev.x,a.y-prev.y)+Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(z.x-b.x,z.y-b.y),steps=Math.min(64,Math.max(6,Math.ceil(length/1.5)));
   for(let j=0;j<=steps;j++){const t=j/steps,u=1-t;out.push([u*u*u*prev.x+3*u*u*t*a.x+3*u*t*t*b.x+t*t*t*z.x,u*u*u*prev.y+3*u*u*t*a.y+3*u*t*t*b.y+t*t*t*z.y]);}
  }prev=z;
 }return out;
}
function logoCurveError(curve,raw){
 const poly=logoCurveSamples(curve),pts=raw.map(p=>[p.x,p.y]);if(poly.length<3)return {mean:Infinity,max:Infinity};
 let sum=0,n=0,max=0;
 function measure(from,to){const step=Math.max(1,Math.ceil(from.length/160));for(let i=0;i<from.length;i+=step){let best=Infinity;for(let j=0;j<to.length;j++)best=Math.min(best,distanceSegment(from[i],to[j],to[(j+1)%to.length]));sum+=best*best;n++;max=Math.max(max,best);}}
 measure(pts,poly);measure(poly,pts);return {mean:sum/n,max};
}
// Refine only handle lengths: endpoints, corner tags and tangent directions stay fixed.
function refineMonoBezier(curve,raw,scale,lattice=raw){
 if(raw.length>1600||curve.n>80)return null;
 // Mixed straight/rounded contours need a separate constrained fit. Preserve them.
 let run=0,lastX=0,lastY=0;const minRun=8*scale;
 for(let j=0;j<lattice.length*2;j++){const a=lattice[j%lattice.length],b=lattice[(j+1)%lattice.length],dx=b.x-a.x,dy=b.y-a.y;if(dx===lastX&&dy===lastY)run+=Math.hypot(dx,dy);else run=Math.hypot(dx,dy);lastX=dx;lastY=dy;if(run>=minRun)return null;}

 const copy={...curve,c:curve.c.map(p=>p?({x:p.x,y:p.y}):p),tag:curve.tag.slice()},c=curve.c;
 let changed=false;
 function nearest(x,y){let best=Infinity,out=null;for(let j=0;j<raw.length;j++){const a=raw[j],b=raw[(j+1)%raw.length],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/l)):0,px=a.x+t*dx,py=a.y+t*dy,e=(x-px)**2+(y-py)**2;if(e<best){best=e;out={x:px,y:py};}}return out;}
 for(let i=0;i<curve.n;i++){
  if(curve.tag[i]==='CORNER')continue;const p0=c[(3*i-1+c.length)%c.length],p1=c[3*i],p2=c[3*i+1],p3=c[3*i+2],v1={x:p1.x-p0.x,y:p1.y-p0.y},v2={x:p2.x-p3.x,y:p2.y-p3.y};
  const l1=Math.hypot(v1.x,v1.y),l2=Math.hypot(v2.x,v2.y);if(l1<scale||l2<scale)continue;
  let aa=0,ab=0,bb=0,ra=0,rb=0;
  for(let j=1;j<20;j++){const t=j/20,u=1-t,b0=u*u*u,b1=3*u*u*t,b2=3*u*t*t,b3=t*t*t,x=b0*p0.x+b1*p1.x+b2*p2.x+b3*p3.x,y=b0*p0.y+b1*p1.y+b2*p2.y+b3*p3.y,target=nearest(x,y),bx=(b0+b1)*p0.x+(b2+b3)*p3.x,by=(b0+b1)*p0.y+(b2+b3)*p3.y,ux=b1*v1.x,uy=b1*v1.y,vx=b2*v2.x,vy=b2*v2.y;
   aa+=ux*ux+uy*uy;ab+=ux*vx+uy*vy;bb+=vx*vx+vy*vy;ra+=ux*(target.x-bx)+uy*(target.y-by);rb+=vx*(target.x-bx)+vy*(target.y-by);
  }
  const reg=(aa+bb)*.1;aa+=reg;bb+=reg;ra+=reg;rb+=reg;const det=aa*bb-ab*ab;if(det<=1e-9)continue;
  const limit1=Math.min(.15,.35*scale/l1),limit2=Math.min(.15,.35*scale/l2),a=Math.max(1-limit1,Math.min(1+limit1,(ra*bb-rb*ab)/det)),b=Math.max(1-limit2,Math.min(1+limit2,(rb*aa-ra*ab)/det));
  copy.c[3*i]={x:p0.x+a*v1.x,y:p0.y+a*v1.y};copy.c[3*i+1]={x:p3.x+b*v2.x,y:p3.y+b*v2.y};if(Math.abs(a-1)+Math.abs(b-1)>.001)changed=true;
 }
 if(!changed)return null;
 const before=logoCurveError(curve,raw),after=logoCurveError(copy,raw);
 return after.mean<before.mean*.9&&after.max<=before.max+.025*scale?copy:null;
}

// ===== VektorKu V2 Pro 1.41: titik lebih hemat dan bentuk geometri =====
// (1) leanPath: kurva hasil Potrace disusun ulang dengan ruas sesedikit mungkin. Titik lama menjadi
//     calon sambungan; beberapa ruas berurutan diganti satu kurva kubik bila kurva itu tidak menyimpang
//     lebih dari batas dari kurva lama. Arah garis singgung di sambungan dipertahankan, jadi lengkung
//     tetap mulus. Sudut tajam dan garis lurus panjang tidak disentuh. Susunan dengan ruas paling
//     sedikit dicari dengan pemrograman dinamis, bukan serakah.
// (2) leanGeometry: kontur yang ternyata lingkaran, elips, persegi (bersudut bulat), atau kapsul
//     ditulis sebagai bentuk itu persis: simetris, 4 sampai 8 titik.
function leanCommands(curve){
 const c=curve.c,n=curve.n,cmd=[];let prev=c[(n-1)*3+2];const start=prev;
 const line=z=>{const k=cmd.length-1;if(k>=0&&cmd[k].type==='L'){const o=cmd[k].from,q=cmd[k].p[0],dx=z.x-o.x,dy=z.y-o.y,len=Math.hypot(dx,dy)||1,along=((q.x-o.x)*dx+(q.y-o.y)*dy)/len;if(Math.abs((q.x-o.x)*dy-(q.y-o.y)*dx)/len<.01&&along>=0&&along<=len){cmd[k].p[0]=z;return;}}cmd.push({type:'L',from:prev,p:[z]});};
 for(let i=0;i<n;i++){
  const a=c[3*i],b=c[3*i+1],z=c[3*i+2];
  if(curve.tag[i]==='CORNER'){line(b);prev=b;line(z);}
  else{const dx=z.x-prev.x,dy=z.y-prev.y,len=Math.hypot(dx,dy)||1,off=q=>Math.abs((q.x-prev.x)*dy-(q.y-prev.y)*dx)/len,along=q=>((q.x-prev.x)*dx+(q.y-prev.y)*dy)/len;
   if(off(a)<.01&&off(b)<.01&&along(a)>=0&&along(b)<=len&&along(a)<=along(b))line(z);else cmd.push({type:'C',from:prev,p:[a,b,z]});}
  prev=z;
 }
 let begin=start;
 if(cmd.length>2&&cmd[0].type==='L'&&cmd[cmd.length-1].type==='L'){const o=cmd[cmd.length-1].from,z=cmd[0].p[0],dx=z.x-o.x,dy=z.y-o.y,len=Math.hypot(dx,dy)||1,along=((start.x-o.x)*dx+(start.y-o.y)*dy)/len;
  if(Math.abs((start.x-o.x)*dy-(start.y-o.y)*dx)/len<.01&&along>=0&&along<=len){begin=o;cmd.pop();cmd[0].from=o;}}
 return {begin,cmd};
}
function leanPath(curve,scale,opt){
 const {cmd}=leanCommands(curve),n=cmd.length;if(n<3)return '';
 const tolBase=opt.tol,hardLen=opt.hardLen,cosBreak=Math.cos(opt.angle||.14),K=opt.reach||12,hidden=opt.hidden,tolHidden=opt.tolHidden||tolBase,truth=opt.truth,snapMax=(.75*scale)**2;
 const unit=(x,y)=>{const l=Math.hypot(x,y);return l>1e-9?{x:x/l,y:y/l}:null;};
 // titik kontur subpiksel sebagai acuan: sampel kurva ditarik ke kontur itu, jadi galat diukur terhadap tepi gambar
 let grid=null;const cell=2*scale;
 if(truth&&truth.length>=8){grid=new Map();for(let i=0;i<truth.length;i++){const key=Math.floor(truth[i].x/cell)*65536+Math.floor(truth[i].y/cell);let g=grid.get(key);if(!g)grid.set(key,g=[]);g.push(i);}}
 const near=(px,py)=>{const cx=Math.floor(px/cell),cy=Math.floor(py/cell),m=truth.length;let best=snapMax,bx=px,by=py,at=-1;
  for(let gy=cy-1;gy<=cy+1;gy++)for(let gx=cx-1;gx<=cx+1;gx++){const g=grid.get(gx*65536+gy);if(!g)continue;
   for(const i of g)for(let q=0;q<2;q++){const j=q?i:(i+m-1)%m,a=truth[j],b=truth[(j+1)%m],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((px-a.x)*dx+(py-a.y)*dy)/l)):0,x=a.x+t*dx,y=a.y+t*dy,e=(px-x)**2+(py-y)**2;if(e<best){best=e;bx=x;by=y;at=j;}}}
  return at<0?null:{x:bx,y:by,i:at,e:best};};
 const pull=p=>{const z=near(p.x,p.y);if(!z)return snapMax;p.x=z.x;p.y=z.y;return z.e;};
 const seg=cmd.map(k=>{const p0=k.from,p3=k.p[k.p.length-1],L=k.type==='L';let p1,p2;
  if(L){p1={x:p0.x+(p3.x-p0.x)/3,y:p0.y+(p3.y-p0.y)/3};p2={x:p0.x+(p3.x-p0.x)*2/3,y:p0.y+(p3.y-p0.y)*2/3};}else{p1=k.p[0];p2=k.p[1];}
  const chord=Math.hypot(p3.x-p0.x,p3.y-p0.y),rough=L?chord:Math.hypot(p1.x-p0.x,p1.y-p0.y)+Math.hypot(p2.x-p1.x,p2.y-p1.y)+Math.hypot(p3.x-p2.x,p3.y-p2.y);
  const count=L?Math.max(1,Math.min(8,Math.ceil(chord/(2*scale)))):Math.max(3,Math.min(16,Math.ceil(rough/(1.2*scale)))),pts=[];let len=0,px=p0.x,py=p0.y;
  for(let q=1;q<=count;q++){const t=q/count,u=1-t,x=u*u*u*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t*t*t*p3.x,y=u*u*u*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t*t*t*p3.y;len+=Math.hypot(x-px,y-py);pts.push({x,y,d:len});px=x;py=y;}
  const t0=unit(p1.x-p0.x,p1.y-p0.y)||unit(p2.x-p0.x,p2.y-p0.y)||unit(p3.x-p0.x,p3.y-p0.y),t1=unit(p3.x-p2.x,p3.y-p2.y)||unit(p3.x-p1.x,p3.y-p1.y)||unit(p3.x-p0.x,p3.y-p0.y);
  // bagian yang tertutup lapisan lain boleh menyimpang lebih jauh; di sana sudut dan garis lurus juga tidak wajib
  let hid=!!hidden&&hidden(p0.x,p0.y);if(hid)for(const p of pts)if(!hidden(p.x,p.y)){hid=false;break;}
  // sq0: seberapa jauh kurva lama dari kontur (dipakai untuk memutuskan apakah ruas tunggal perlu dicocokkan ulang)
  let sq0=-1;if(grid&&!L&&!hid){sq0=0;for(let q=0;q<pts.length;q++){const e=pull(pts[q]);if(q<pts.length-1)sq0+=e;}}
  return {L,p0,p1,p2,p3,len,pts,t0,t1,hid,sq0,tol:hid?tolHidden:L?Math.min(tolBase,opt.tolLine||tolBase):tolBase,hard:L&&chord>=hardLen&&!hid,dead:!t0||!t1||len<1e-6};});
 // sambungan mulus antara dua kurva dipindahkan ke kontur itu sendiri, dengan arah singgung dari kontur di sekitarnya
 if(grid&&opt.move===true)for(let k=0;k<n;k++){const a=seg[(k+n-1)%n],b=seg[k];if(a.L||b.L||a.hid||b.hid||a.dead||b.dead||a.t1.x*b.t0.x+a.t1.y*b.t0.y<cosBreak)continue;
  const z=near(b.p0.x,b.p0.y);if(!z)continue;const m=truth.length,w=Math.max(2,Math.min(Math.round(5*scale),Math.floor(.3*Math.min(a.len,b.len))));if(2*w+2>=m)continue;
  let cx=0,cy=0;for(let q=-w;q<=w+1;q++){const p=truth[(z.i+q+m)%m];cx+=p.x;cy+=p.y;}cx/=2*w+2;cy/=2*w+2;
  let xx=0,xy=0,yy=0;for(let q=-w;q<=w+1;q++){const p=truth[(z.i+q+m)%m],x=p.x-cx,y=p.y-cy;xx+=x*x;xy+=x*y;yy+=y*y;}
  const an=.5*Math.atan2(2*xy,xx-yy);let tx=Math.cos(an),ty=Math.sin(an);const dot=tx*b.t0.x+ty*b.t0.y;if(dot<0){tx=-tx;ty=-ty;}if(Math.abs(dot)<.9)continue;
  const node={x:z.x,y:z.y},t={x:tx,y:ty};a.p3=node;b.p0=node;a.t1=t;b.t0=t;a.moved=b.moved=true;}
 // sambungan keras: sudut, ujung garis lurus panjang, ruas cacat
 const brk=new Uint8Array(n);let any=false;
 for(let k=0;k<n;k++){const a=seg[(k+n-1)%n],b=seg[k];brk[k]=a.dead||b.dead||(!(a.hid&&b.hid)&&(a.hard||b.hard||a.t1.x*b.t0.x+a.t1.y*b.t0.y<cosBreak))?1:0;if(brk[k])any=true;}
 // satu kurva untuk ruas i..j-1 dari sebuah deret
 function fit(R,i,j,force){
  const P0=R[i].p0,P3=R[j-1].p3,t0=R[i].t0,t1={x:-R[j-1].t1.x,y:-R[j-1].t1.y},chord=Math.hypot(P3.x-P0.x,P3.y-P0.y);let total=0;for(let k=i;k<j;k++)total+=R[k].len;
  if(chord<.02*total||chord<1e-6)return null;
  const X=[],Y=[],U=[],T=[];let acc=0;for(let k=i;k<j;k++){const s=R[k];for(const p of s.pts){X.push(p.x);Y.push(p.y);U.push((acc+p.d)/total);T.push(s.tol);}acc+=s.len;}
  const m=X.length-1;                                      // titik terakhir = P3
  let p1x,p1y,p2x,p2y,worst=Infinity,sq=0;
  for(let iter=0;iter<4;iter++){
   let c00=0,c01=0,c11=0,x0=0,x1=0;
   for(let k=0;k<m;k++){const u=U[k],v=1-u,b0=v*v*v,b1=3*v*v*u,b2=3*v*u*u,b3=u*u*u,a1x=t0.x*b1,a1y=t0.y*b1,a2x=t1.x*b2,a2y=t1.y*b2,rx=X[k]-(P0.x*(b0+b1)+P3.x*(b2+b3)),ry=Y[k]-(P0.y*(b0+b1)+P3.y*(b2+b3));
    c00+=a1x*a1x+a1y*a1y;c01+=a1x*a2x+a1y*a2y;c11+=a2x*a2x+a2y*a2y;x0+=a1x*rx+a1y*ry;x1+=a2x*rx+a2y*ry;}
   const det=c00*c11-c01*c01;let al,be;if(Math.abs(det)>1e-9*c00*c11){al=(x0*c11-x1*c01)/det;be=(c00*x1-c01*x0)/det;}else al=be=chord/3;
   if(!(al>1e-3*chord)||!(be>1e-3*chord))al=be=chord/3;
   if(al>total||be>total){if(!force)return null;al=Math.min(al,total);be=Math.min(be,total);}
   p1x=P0.x+al*t0.x;p1y=P0.y+al*t0.y;p2x=P3.x+be*t1.x;p2y=P3.y+be*t1.y;
   worst=0;sq=0;
   for(let k=0;k<m;k++){const u=U[k],v=1-u,b0=v*v*v,b1=3*v*v*u,b2=3*v*u*u,b3=u*u*u,dx=b0*P0.x+b1*p1x+b2*p2x+b3*P3.x-X[k],dy=b0*P0.y+b1*p1y+b2*p2y+b3*P3.y-Y[k],e=dx*dx+dy*dy;sq+=e;const r=e/(T[k]*T[k]);if(r>worst)worst=r;}
   if(worst<=1)break;if(iter===3||(worst>36&&!force))break;
   // parameter tiap sampel digeser ke titik terdekat pada kurva (Newton)
   for(let k=0;k<m;k++){const u=U[k],v=1-u,bx=v*v*v*P0.x+3*v*v*u*p1x+3*v*u*u*p2x+u*u*u*P3.x-X[k],by=v*v*v*P0.y+3*v*v*u*p1y+3*v*u*u*p2y+u*u*u*P3.y-Y[k],
     d1x=3*(v*v*(p1x-P0.x)+2*v*u*(p2x-p1x)+u*u*(P3.x-p2x)),d1y=3*(v*v*(p1y-P0.y)+2*v*u*(p2y-p1y)+u*u*(P3.y-p2y)),d2x=6*(v*(p2x-2*p1x+P0.x)+u*(P3.x-2*p2x+p1x)),d2y=6*(v*(p2y-2*p1y+P0.y)+u*(P3.y-2*p2y+p1y)),
     den=d1x*d1x+d1y*d1y+bx*d2x+by*d2y;if(Math.abs(den)>1e-12){const z=u-(bx*d1x+by*d1y)/den;U[k]=z<0?0:z>1?1:z;}}
  }
  if(force){let hid=true;for(let k=i;k<j;k++)if(!R[k].hid){hid=false;break;}return {L:false,p0:P0,p1:{x:p1x,y:p1y},p2:{x:p2x,y:p2y},p3:P3,sq,hid};}
  if(worst>1)return null;
  // arah sebaliknya: kurva baru tidak boleh menggembung menjauhi kurva lama di antara sampel
  const Q=Math.min(20,2*m+2);let tolMin=Infinity;for(let k=0;k<=m;k++)if(T[k]<tolMin)tolMin=T[k];const lim=(1.35*tolMin)**2;
  for(let q=1;q<Q;q++){const u=q/Q,v=1-u,x=v*v*v*P0.x+3*v*v*u*p1x+3*v*u*u*p2x+u*u*u*P3.x,y=v*v*v*P0.y+3*v*v*u*p1y+3*v*u*u*p2y+u*u*u*P3.y;let best=Infinity,ax=P0.x,ay=P0.y;
   for(let k=0;k<=m&&best>lim;k++){const bx=X[k],by=Y[k],dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/l)):0,e=(x-ax-t*dx)**2+(y-ay-t*dy)**2;if(e<best)best=e;ax=bx;ay=by;}
   if(best>lim)return null;}
  let hid=true;for(let k=i;k<j;k++)if(!R[k].hid){hid=false;break;}
  return {L:false,p0:P0,p1:{x:p1x,y:p1y},p2:{x:p2x,y:p2y},p3:P3,sq,hid};
 }
 // ruas tunggal: kurva lama, kecuali ujungnya dipindahkan atau kurva yang dicocokkan ke kontur lebih dekat
 function single(R,i){const s=R[i];if(s.one!==undefined)return s.one;let out=s;
  if(!s.L&&!s.dead&&(s.moved||(s.sq0>0&&opt.refit!==false))){const p=fit(R,i,i+1,true);
   if(p&&(s.moved||p.sq<s.sq0))out=p;
   else if(s.moved){const c=Math.hypot(s.p3.x-s.p0.x,s.p3.y-s.p0.y)/3;out={L:false,p0:s.p0,p1:{x:s.p0.x+c*s.t0.x,y:s.p0.y+c*s.t0.y},p2:{x:s.p3.x-c*s.t1.x,y:s.p3.y-c*s.t1.y},p3:s.p3,sq:s.sq0,hid:s.hid};}}
  return s.one=out;}
 // susunan dengan ruas paling sedikit (galat terkecil bila sama banyak)
 function plan(R){
  const m=R.length;if(m===1)return [single(R,0)];
  const cnt=new Int32Array(m+1),err=new Float64Array(m+1),from=new Int32Array(m+1),piece=new Array(m+1);
  for(let j=1;j<=m;j++){cnt[j]=1e9;let fail=0;
   for(let i=j-1;i>=0&&j-i<=K;i--){const p=j-i===1?single(R,i):fit(R,i,j);if(!p){if(++fail>=2)break;continue;}
    const c=cnt[i]+1,e=err[i]+(p.sq||0);if(c<cnt[j]||(c===cnt[j]&&e<err[j])){cnt[j]=c;err[j]=e;from[j]=i;piece[j]=p;}}}
  const out=[];for(let j=m;j>0;j=from[j])out.push(piece[j]);return out.reverse();
 }
 let pieces=[];
 if(any){let s=0;while(!brk[s])s++;
  for(let k=0;k<n;){let e=k+1;while(e<n&&!brk[(s+e)%n])e++;const R=[];for(let q=k;q<e;q++)R.push(seg[(s+q)%n]);pieces.push(...(R[0].hard?R:plan(R)));k=e;}
 }else{
  // kontur mulus tertutup: titik awal ikut menentukan; coba dua titik awal, ambil yang lebih hemat
  const turn=s=>{const R=[];for(let q=0;q<n;q++)R.push(seg[(s+q)%n]);return plan(R);};
  pieces=turn(0);
  if(pieces.length>1){let at=0;while(at<n&&seg[at].p3!==pieces[0].p3)at++;at++;
   if(at<n){const alt=turn(at);if(alt.length<pieces.length)pieces=alt;}}
 }
 if(self.__st)for(const p of pieces.length>=n?seg:pieces){if(p.hid)self.__st.h=(self.__st.h||0)+1;else self.__st.v=(self.__st.v||0)+1;}
 if(pieces.length>n)return '';
 const f=q=>+q.x.toFixed(2)+' '+ +q.y.toFixed(2);
 return 'M '+f(pieces[0].p0)+' '+pieces.map(p=>p.L?'L '+f(p.p3):'C '+f(p.p1)+' '+f(p.p2)+' '+f(p.p3)).join(' ');
}
// Bentuk geometri dari titik kontur subpiksel. reg: pusat bentuk yang sudah dikenali (supaya sepusat benar-benar sepusat).
let leanCenters=[],leanHidden=null,leanClass=null,leanCover=null,leanOwn=null;
// Urutan: bentuk bulat yang pas ketat, lalu poligon, baru bentuk bulat dengan kelonggaran (lingkaran yang aslinya sedikit peyot).
function leanGeometry(pt,scale,opt={}){return leanRound(pt,scale,{strict:true})||leanPolyArc(pt,scale,null,null)||leanPolygon(pt,scale)||(opt.loose===false?'':leanRound(pt,scale,{}));}
function leanRound(pt,scale,opt={}){
 const n=pt.length;if(n<10)return '';
 const ox=pt[0].x,oy=pt[0].y;let A=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(let i=0;i<n;i++){const px=pt[i].x-ox,py=pt[i].y-oy,q=pt[(i+1)%n],qx=q.x-ox,qy=q.y-oy,cr=px*qy-qx*py;A+=cr;sx+=(px+qx)*cr;sy+=(py+qy)*cr;sxx+=(px*px+px*qx+qx*qx)*cr;syy+=(py*py+py*qy+qy*qy)*cr;sxy+=(px*qy+2*px*py+2*qx*qy+qx*py)*cr;
  if(px<minX)minX=px;if(px>maxX)maxX=px;if(py<minY)minY=py;if(py>maxY)maxY=py;}
 A/=2;const area=Math.abs(A);if(area<12*scale*scale)return '';
 const mx=sx/(6*A),my=sy/(6*A),ixx=sxx/(12*A)-mx*mx,iyy=syy/(12*A)-my*my,ixy=sxy/(24*A)-mx*my,size=Math.max(maxX-minX,maxY-minY);
 const tr=ixx+iyy,df=Math.hypot(ixx-iyy,2*ixy),l1=(tr+df)/2,l2=(tr-df)/2,minor=4*Math.sqrt(Math.max(0,l2));
 // batas sisa galat: mutlak untuk bentuk sedang, lebih ketat untuk bentuk kecil dan ramping (batang huruf), longgar hanya di putaran kedua
 // Lingkaran sejati menyisakan galat sekitar 0,1 px berapa pun ukurannya; huruf "o" 0,6-1,5% dari ukurannya.
 if(!opt.strict&&size<80*scale)return '';
 const tolMax=opt.strict?Math.max(.15*scale,Math.min(.3*scale,.006*size,.07*minor)):Math.min(1.2*scale,.0045*size),tolRms=.5*tolMax,f=v=>+v.toFixed(2);
 const snap=(x,y)=>{for(const c of leanCenters)if(Math.hypot(c.x-x,c.y-y)<.4*scale)return c;const c={x,y};leanCenters.push(c);return c;};
 // ---- elips / lingkaran: momen luas memberi pusat, sumbu, dan arah
 if(l2>0){
  let a=2*Math.sqrt(l1),b=2*Math.sqrt(l2),th=.5*Math.atan2(2*ixy,ixx-iyy);
  if(Math.abs(Math.PI*a*b-area)<.02*area&&a/b<8){
   const co=Math.cos(th),si=Math.sin(th);let worst=0,sum=0;
   for(let i=0;i<n&&worst<=tolMax;i++){const dx=pt[i].x-ox-mx,dy=pt[i].y-oy-my,u=(dx*co+dy*si)/a,v=(-dx*si+dy*co)/b,g=Math.hypot(u/a,v/b),e=g?Math.abs(u*u+v*v-1)/(2*g):a;if(e>worst)worst=e;sum+=e*e;}
   if(self.__geo)self.__geo.push({k:'elips',x:ox+mx,y:oy+my,a,b,th,worst,rms:Math.sqrt(sum/n),tolMax,n});
   if(worst<=tolMax&&Math.sqrt(sum/n)<=tolRms){
    if(a-b<=Math.max(.3*scale,.012*a)){a=b=(a+b)/2;th=0;}
    else if(Math.abs(Math.sin(th))*a<.3*scale)th=0;else if(Math.abs(Math.cos(th))*a<.3*scale)th=Math.PI/2;
    const c=snap(ox+mx,oy+my),ux=a*Math.cos(th),uy=a*Math.sin(th),vx=-b*Math.sin(th),vy=b*Math.cos(th),k=.5522847498,P=(p,q)=>f(c.x+p*ux+q*vx)+' '+f(c.y+p*uy+q*vy);
    return 'M '+P(1,0)+' C '+P(1,k)+' '+P(k,1)+' '+P(0,1)+' C '+P(-k,1)+' '+P(-1,k)+' '+P(-1,0)+' C '+P(-1,-k)+' '+P(-k,-1)+' '+P(0,-1)+' C '+P(k,-1)+' '+P(1,-k)+' '+P(1,0)+' Z';
   }
  }
 }
 // ---- persegi, persegi bersudut bulat, kapsul: arah dari sisi-sisinya, jari-jari sudut dari luasnya
 const step=Math.max(2,Math.min(8,n>>4));let ex=0,ey=0,tot=0;
 for(let i=0;i<n;i++){const p=pt[i],q=pt[(i+step)%n],dx=q.x-p.x,dy=q.y-p.y,l=Math.hypot(dx,dy);if(!l)continue;const an=4*Math.atan2(dy,dx);ex+=l*Math.cos(an);ey+=l*Math.sin(an);tot+=l;}
 if(!tot||Math.hypot(ex,ey)/tot<.3)return '';
 let th=Math.atan2(ey,ex)/4;const fit=th=>{
  const co=Math.cos(th),si=Math.sin(th),U=new Float64Array(n),V=new Float64Array(n);let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
  for(let i=0;i<n;i++){const dx=pt[i].x-ox,dy=pt[i].y-oy,u=dx*co+dy*si,v=-dx*si+dy*co;U[i]=u;V[i]=v;if(u<u0)u0=u;if(u>u1)u1=u;if(v<v0)v0=v;if(v>v1)v1=v;}
  let r=0;
  for(let pass=0;pass<2;pass++){
   const w=u1-u0,h=v1-v0;r=Math.sqrt(Math.max(0,(w*h-area)/(4-Math.PI)));r=Math.min(r,Math.min(w,h)/2);
   // sisi lurus: rata-rata posisi titik di bagian tengah tiap sisi (bebas dari satu titik yang menonjol)
   const mu=(u0+u1)/2,mv=(v0+v1)/2,hu=w/2-r-scale,hv=h/2-r-scale,s=[0,0,0,0],c=[0,0,0,0];
   for(let i=0;i<n;i++){const u=U[i],v=V[i];if(Math.abs(v-mv)<hv){if(u<mu){s[0]+=u;c[0]++;}else{s[1]+=u;c[1]++;}}if(Math.abs(u-mu)<hu){if(v<mv){s[2]+=v;c[2]++;}else{s[3]+=v;c[3]++;}}}
   if(c[0]>=3&&c[1]>=3){u0=s[0]/c[0];u1=s[1]/c[1];}if(c[2]>=3&&c[3]>=3){v0=s[2]/c[2];v1=s[3]/c[3];}
  }
  const w=u1-u0,h=v1-v0;r=Math.sqrt(Math.max(0,(w*h-area)/(4-Math.PI)));r=Math.min(r,Math.min(w,h)/2);
  // sudut yang jari-jarinya di bawah ~1,75 px tidak terbedakan dari sudut tajam yang dihaluskan antialias
  if(r<1.75*scale)r=0;else if(r>Math.min(w,h)/2-.35*scale)r=Math.min(w,h)/2;
  const mu=(u0+u1)/2,mv=(v0+v1)/2,hw=w/2-r,hh=h/2-r;let worst=0,sum=0;
  for(let i=0;i<n;i++){const qx=Math.abs(U[i]-mu)-hw,qy=Math.abs(V[i]-mv)-hh,e=Math.abs(Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r);if(e>worst)worst=e;sum+=e*e;}
  return {co,si,mu,mv,w,h,r,hw,hh,worst,rms:Math.sqrt(sum/n)};};
 let g=fit(th);
 if(Math.abs(Math.sin(th))*Math.max(g.w,g.h)/2<.35*scale){const z=fit(0);if(z.worst<=tolMax&&z.rms<=tolRms){g=z;th=0;}}
 if(self.__geo)self.__geo.push({k:'persegi',x:ox+g.mu*g.co-g.mv*g.si,y:oy+g.mu*g.si+g.mv*g.co,a:g.w,b:g.h,th,r:g.r,worst:g.worst,rms:g.rms,tolMax,n});
 if(g.worst>tolMax||g.rms>tolRms||Math.min(g.w,g.h)<3*scale||Math.max(g.hw,g.hh)<1.5*scale)return '';
 const {co,si,mu,mv,r,hw,hh}=g,c=snap(ox+mu*co-mv*si,oy+mu*si+mv*co),k=.5522847498*r,P=(u,v)=>f(c.x+u*co-v*si)+' '+f(c.y+u*si+v*co),X=hw+r,Y=hh+r;
 if(!r)return 'M '+P(-X,-Y)+' L '+P(X,-Y)+' L '+P(X,Y)+' L '+P(-X,Y)+' Z';
 let d='M '+P(hw,-Y)+' C '+P(hw+k,-Y)+' '+P(X,-hh-k)+' '+P(X,-hh);
 if(hh>.01)d+=' L '+P(X,hh);
 d+=' C '+P(X,hh+k)+' '+P(hw+k,Y)+' '+P(hw,Y);
 if(hw>.01)d+=' L '+P(-hw,Y);
 d+=' C '+P(-hw-k,Y)+' '+P(-X,hh+k)+' '+P(-X,hh);
 if(hh>.01)d+=' L '+P(-X,-hh);
 d+=' C '+P(-X,-hh-k)+' '+P(-hw-k,-Y)+' '+P(-hw,-Y);
 return d+' Z';
}
// jumlah titik sebuah kontur tunggal (M ... tanpa sub-kontur lain)
function leanCount(d){const v=d.match(/-?\d+(?:\.\d+)?/g)||[],k=(d.match(/[LC]/g)||[]).length;return k+(v.length>=4&&Math.hypot(v[0]-v[v.length-2],v[1]-v[v.length-1])<.02?0:1);}
// Poligon bersisi lurus (segitiga, bintang, panah, belah ketupat): tiap sisi = garis kuadrat-terkecil lewat titik
// kontur di bagian tengah sisi itu; titik sudut = perpotongan dua sisi, jadi sudut tetap tajam walau di gambar
// asalnya membulat oleh antialias. Kontur yang punya bagian melengkung tidak lolos uji lurus dan dibiarkan.
function leanPolygon(pt,scale){
 const bad=w=>{if(self.__pg)self.__pg.push(w+':'+pt.length);return '';};
 const n=pt.length;if(n<12)return bad(1);
 // penyederhanaan kasar (Douglas-Peucker tertutup) untuk menemukan calon sudut
 let i0=0,i1=0,far=-1;for(let i=1;i<n;i++){const d=(pt[i].x-pt[0].x)**2+(pt[i].y-pt[0].y)**2;if(d>far){far=d;i1=i;}}
 far=-1;for(let i=0;i<n;i++){const d=(pt[i].x-pt[i1].x)**2+(pt[i].y-pt[i1].y)**2;if(d>far){far=d;i0=i;}}
 if(i0===i1)return bad(2);const keep=new Set([i0,i1]),tol=1.2*scale,stack=[[i0,i1],[i1,i0]];
 while(stack.length){const [a,b]=stack.pop(),A=pt[a],B=pt[b],dx=B.x-A.x,dy=B.y-A.y,l=Math.hypot(dx,dy)||1;let worst=tol,at=-1;
  for(let i=(a+1)%n;i!==b;i=(i+1)%n){const d=Math.abs((pt[i].x-A.x)*dy-(pt[i].y-A.y)*dx)/l;if(d>worst){worst=d;at=i;}}
  if(at>=0){keep.add(at);if(keep.size>26)return bad(3);stack.push([a,at],[at,b]);}}
 // urut searah kontur mulai i0
 const idx=[...keep].map(i=>(i-i0+n)%n).sort((a,b)=>a-b).map(k=>(k+i0)%n);let m=idx.length;if(m<3)return bad(4);
 const lines=[];
 for(let k=0;k<m;k++){const a=idx[k],b=idx[(k+1)%m],c=(b-a+n)%n,A=pt[a],B=pt[b],len=Math.hypot(B.x-A.x,B.y-A.y);
  // potongan sangat pendek = ujung yang tumpul oleh antialias: dilewati, sudutnya dicari dari dua sisi panjang yang mengapitnya
  if(len<4*scale||c<5){if(len>3.2*scale)return bad(5);continue;}
  const trim=Math.max(1,Math.min(Math.ceil(2*scale),Math.floor(c/4))),from=trim,to=c-trim,used=to-from+1;if(used<3)return bad(6);
  let cx=0,cy=0;for(let q=from;q<=to;q++){const p=pt[(a+q)%n];cx+=p.x;cy+=p.y;}cx/=used;cy/=used;
  let xx=0,xy=0,yy=0;for(let q=from;q<=to;q++){const p=pt[(a+q)%n],x=p.x-cx,y=p.y-cy;xx+=x*x;xy+=x*y;yy+=y*y;}
  const an=.5*Math.atan2(2*xy,xx-yy);let ux=Math.cos(an),uy=Math.sin(an);if(ux*(B.x-A.x)+uy*(B.y-A.y)<0){ux=-ux;uy=-uy;}
  let worst=0,sum=0;for(let q=from;q<=to;q++){const p=pt[(a+q)%n],d=Math.abs((p.x-cx)*uy-(p.y-cy)*ux);if(d>worst)worst=d;sum+=d*d;}
  // lengkung landai (lubang huruf, sisi yang membusur) bukan sisi lurus: batasnya ikut panjang sisi
  const lim=Math.max(.15*scale,Math.min(.32*scale,.012*len));if(worst>lim||Math.sqrt(sum/used)>.5*lim)return bad(7);
  // sisi yang nyaris mendatar atau tegak dibuat tepat mendatar atau tegak
  if(Math.abs(uy)*len<.3*scale){ux=Math.sign(ux);uy=0;}else if(Math.abs(ux)*len<.3*scale){uy=Math.sign(uy);ux=0;}
  lines.push({cx,cy,ux,uy,a,b});}
 const out=[],m0=m;m=lines.length;if(m<3)return bad(11);
 for(let k=0;k<m;k++){const a=lines[(k+m-1)%m],b=lines[k],det=a.ux*b.uy-a.uy*b.ux;if(Math.abs(det)<.2)return bad(8);
  const t=((b.cx-a.cx)*b.uy-(b.cy-a.cy)*b.ux)/det,x=a.cx+t*a.ux,y=a.cy+t*a.uy,P1=pt[a.b],P2=pt[b.a],P=Math.hypot(x-P1.x,y-P1.y)<Math.hypot(x-P2.x,y-P2.y)?P1:P2;
  // antialias menumpulkan sudut kira-kira sejauh 1 piksel sumber dibagi sinus setengah sudutnya
  const half=Math.max(.2,Math.sqrt(Math.max(0,(1+(a.ux*b.ux+a.uy*b.uy))/2)));   // sinus setengah sudut dalamif(Math.hypot(x-P.x,y-P.y)>1.6*scale/half+1.2*scale)return bad(9);
  out.push([x,y,Math.min(6,1.5/half+1.5)*scale,Math.min(2.2,.55/half)*scale]);}
 // tiap titik kontur harus dekat ke poligon, kecuali di zona sudut yang memang membulat
 for(let i=0;i<n;i++){const p=pt[i];let best=Infinity,corner=Infinity,at=0;
  for(let k=0;k<m;k++){const A=out[k],B=out[(k+1)%m],dx=B[0]-A[0],dy=B[1]-A[1],l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-A[0])*dx+(p.y-A[1])*dy)/l)):0,e=Math.hypot(p.x-A[0]-t*dx,p.y-A[1]-t*dy);if(e<best)best=e;const c=Math.hypot(p.x-A[0],p.y-A[1]);if(c<corner){corner=c;at=k;}}
  if(best>.45*scale&&!(corner<out[at][2]&&best<out[at][3]))return bad(10);}
 const f=v=>+v.toFixed(2);return 'M '+out.map(p=>f(p[0])+' '+f(p[1])).join(' L ')+' Z';
}
// ===== VektorKu V2 Pro 1.42: bentuk bersudut bulat dan bentuk yang tertimpa =====
// Kelas tiap titik kontur (cls): 0 = tepi bentuk itu sendiri yang terlihat, 3 = terlihat tetapi tepat di sebelah
// sambungan (tidak dipakai untuk mengukur), 1 = dekat sambungan dengan bentuk
// penutup (tidak dipakai untuk mengukur), 2 = tersembunyi di bawah bentuk lain. Bentuk dicocokkan hanya ke titik
// kelas 0, lalu digambar utuh; bagian yang tidak terlihat harus seluruhnya berada di bawah lapisan penutup
// (cover(x,y) benar), jadi tidak ada yang berubah di bagian yang tampak.
function leanEllipseD(cx,cy,a,b,th,scale){
 if(a-b<=Math.max(.3*scale,.012*a)){a=b=(a+b)/2;th=0;}
 else if(Math.abs(Math.sin(th))*a<.3*scale)th=0;else if(Math.abs(Math.cos(th))*a<.3*scale)th=Math.PI/2;
 let c=null;for(const z of leanCenters)if(Math.hypot(z.x-cx,z.y-cy)<.4*scale){c=z;break;}if(!c){c={x:cx,y:cy};leanCenters.push(c);}
 const f=v=>+v.toFixed(2),ux=a*Math.cos(th),uy=a*Math.sin(th),vx=-b*Math.sin(th),vy=b*Math.cos(th),k=.5522847498,P=(p,q)=>f(c.x+p*ux+q*vx)+' '+f(c.y+p*uy+q*vy);
 return 'M '+P(1,0)+' C '+P(1,k)+' '+P(k,1)+' '+P(0,1)+' C '+P(-k,1)+' '+P(-1,k)+' '+P(-1,0)+' C '+P(-1,-k)+' '+P(-k,-1)+' '+P(0,-1)+' C '+P(k,-1)+' '+P(1,-k)+' '+P(1,0)+' Z';
}
// "dekat titik terlihat": dipakai untuk memaafkan sampel di sekitar tepi yang memang tampak dan di sekitar sambungan
// (semua titik kontur kecuali yang jauh di bawah lapisan lain)
function leanNear(pt,cls,scale){const cell=2*scale,grid=new Map(),n=pt.length;for(let i=0;i<n;i++){if(cls&&cls[i]===2)continue;const key=Math.floor(pt[i].x/cell)*65536+Math.floor(pt[i].y/cell);let g=grid.get(key);if(!g)grid.set(key,g=[]);g.push(i);}
 return (x,y,lim)=>{const cx=Math.floor(x/cell),cy=Math.floor(y/cell),r=Math.max(1,Math.ceil(lim/cell));for(let gy=cy-r;gy<=cy+r;gy++)for(let gx=cx-r;gx<=cx+r;gx++){const g=grid.get(gx*65536+gy);if(g)for(const i of g)if(Math.hypot(pt[i].x-x,pt[i].y-y)<=lim)return true;}return false;};}
// Bentuk baru boleh berbeda dari kontur lama hanya di tempat yang tidak terlihat: tiap piksel yang masuk ke salah satu
// saja (selisih simetris) harus milik lapisan di atasnya, kecuali piksel di sepanjang tepi yang memang tampak.
function leanXorOK(pt,cls,poly,scale,free){
 const near=leanNear(pt,cls,scale),own=leanOwn,n=pt.length,m=poly.length;let y0=Infinity,y1=-Infinity;
 for(let i=0;i<n;i++){const y=pt[i].y;if(y<y0)y0=y;if(y>y1)y1=y;}for(let i=0;i<m;i++){const y=poly[i][1];if(y<y0)y0=y;if(y>y1)y1=y;}
 const ev=[];
 for(let y=Math.floor(y0);y<=Math.floor(y1);y++){const yc=y+.5;ev.length=0;
  for(let i=0;i<n;i++){const a=pt[i],b=pt[i+1===n?0:i+1];if((a.y>yc)!==(b.y>yc))ev.push([a.x+(yc-a.y)*(b.x-a.x)/(b.y-a.y),0]);}
  for(let i=0;i<m;i++){const a=poly[i],b=poly[i+1===m?0:i+1];if((a[1]>yc)!==(b[1]>yc))ev.push([a[0]+(yc-a[1])*(b[0]-a[0])/(b[1]-a[1]),1]);}
  ev.sort((p,q)=>p[0]-q[0]);let inOld=false,inNew=false;
  for(let k=0;k+1<ev.length;k++){if(ev[k][1])inNew=!inNew;else inOld=!inOld;if(inOld===inNew)continue;
   for(let x=Math.ceil(ev[k][0]-.5);x+.5<ev[k+1][0];x++){const cx=x+.5;if(near(cx,yc,1.5*scale))continue;if(!free(cx,yc))return false;
    // Bagian yang dibuang tidak boleh menempel pada piksel lapisan ini: di sana lapisan ini harus tetap menjorok ke bawah
    // lapisan di atasnya, kalau tidak sambungan kedua warna menyisakan garis tipis.
    if(inOld&&!inNew&&own&&own(cx,yc))return false;}}}
 return true;
}
// Lingkaran atau elips dari busur yang terlihat saja.
function leanRoundPartial(pt,scale,cls,cover){
 const n=pt.length,X=[],Y=[];let mx=0,my=0;for(let i=0;i<n;i++)if(!cls[i]){X.push(pt[i].x);Y.push(pt[i].y);mx+=pt[i].x;my+=pt[i].y;}
 const m=X.length;if(m<16)return '';mx/=m;my/=m;
 // ---- lingkaran: kuadrat terkecil aljabar, lalu dua langkah perbaikan jarak
 let sxx=0,sxy=0,syy=0,sxz=0,syz=0,sz=0;for(let i=0;i<m;i++){const x=X[i]-mx,y=Y[i]-my,z=x*x+y*y;sxx+=x*x;sxy+=x*y;syy+=y*y;sxz+=x*z;syz+=y*z;sz+=z;}
 const det=sxx*syy-sxy*sxy;if(Math.abs(det)<1e-9)return '';
 let cx=(sxz*syy-syz*sxy)/(2*det),cy=(syz*sxx-sxz*sxy)/(2*det),r=Math.sqrt(cx*cx+cy*cy+sz/m);
 for(let it=0;it<3;it++){let a11=0,a12=0,a13=0,a22=0,a23=0,b1=0,b2=0,b3=0;
  for(let i=0;i<m;i++){const dx=X[i]-mx-cx,dy=Y[i]-my-cy,d=Math.hypot(dx,dy)||1,jx=-dx/d,jy=-dy/d,e=d-r;a11+=jx*jx;a12+=jx*jy;a13-=jx;a22+=jy*jy;a23-=jy;b1-=jx*e;b2-=jy*e;b3+=e;}
  const sol=solveSmall([[a11,a12,a13],[a12,a22,a23],[a13,a23,m]],[[b1,b2,b3]]);if(!sol)break;cx+=sol[0][0];cy+=sol[0][1];r+=sol[0][2];}
 const check=(dist,angle,size,need)=>{const tol=Math.max(.15*scale,Math.min(.3*scale,.006*size));let worst=0,sum=0;const bins=new Uint8Array(72);
  for(let i=0;i<m;i++){const e=Math.abs(dist(X[i],Y[i]));if(e>worst)worst=e;sum+=e*e;bins[Math.min(71,Math.floor((angle(X[i],Y[i])+Math.PI)*36/Math.PI))]=1;}
  let covered=0;for(let k=0;k<72;k++)covered+=bins[k];
  if(self.__padbg)console.log('  bulat sebagian: titik',m,'maks',worst.toFixed(2),'rms',Math.sqrt(sum/m).toFixed(2),'batas',tol.toFixed(2),'sudut terisi',covered*5,'perlu',need*5);
  return worst<=tol&&Math.sqrt(sum/m)<=.5*tol&&covered>=need?bins:null;};
 // bagian yang dilengkapi harus berada di bawah penutup
 const hiddenOK=(bins,point,size)=>{const steps=Math.max(24,Math.min(720,Math.ceil(Math.PI*size/scale))),poly=[];for(let q=0;q<steps;q++)poly.push(point(q/steps*2*Math.PI-Math.PI));return leanXorOK(pt,cls,poly,scale,cover);};
 if(self.__padbg)console.log('  lingkaran r',r.toFixed(1),'pusat',(mx+cx).toFixed(1),(my+cy).toFixed(1));
 if(r>=3*scale&&r<1e5){const ax=mx+cx,ay=my+cy,bins=check((x,y)=>Math.hypot(x-ax,y-ay)-r,(x,y)=>Math.atan2(y-ay,x-ax),2*r,28);
  if(bins&&hiddenOK(bins,t=>[ax+r*Math.cos(t),ay+r*Math.sin(t)],2*r))return leanEllipseD(ax,ay,r,r,0,scale);}
 // ---- elips: kerucut A x² + B xy + C y² + D x + E y = 1 pada koordinat terpusat dan terskala
 let s0=0;for(let i=0;i<m;i++)s0+=Math.hypot(X[i]-mx,Y[i]-my);s0=m/s0;
 const M=[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],rhs=[0,0,0,0,0];
 for(let i=0;i<m;i++){const x=(X[i]-mx)*s0,y=(Y[i]-my)*s0,v=[x*x,x*y,y*y,x,y];for(let a=0;a<5;a++){rhs[a]+=v[a];for(let b=0;b<5;b++)M[a][b]+=v[a]*v[b];}}
 const sol=solveSmall(M,[rhs]);if(!sol)return '';const [A,B,C,D,E]=sol[0],dd=4*A*C-B*B;if(!(dd>1e-9))return '';
 const x0=(B*E-2*C*D)/dd,y0=(B*D-2*A*E)/dd,g=1-(A*x0*x0+B*x0*y0+C*y0*y0+D*x0+E*y0),tr=A+C,df=Math.hypot(A-C,B),l1=(tr-df)/2,l2=(tr+df)/2;
 if(!(g>0)||!(l1>0))return '';
 const a=Math.sqrt(g/l1)/s0,b=Math.sqrt(g/l2)/s0,th=.5*Math.atan2(-B,C-A)+Math.PI/2,ex=mx+x0/s0,ey=my+y0/s0,co=Math.cos(th),si=Math.sin(th);
 // arah sumbu panjang: vektor eigen untuk nilai eigen terkecil; diperiksa dengan mencoba kedua kemungkinan
 const mk=(co,si)=>({dist:(x,y)=>{const dx=x-ex,dy=y-ey,u=(dx*co+dy*si)/a,v=(-dx*si+dy*co)/b,gg=Math.hypot(u/a,v/b);return gg?(u*u+v*v-1)/(2*gg):a;},ang:(x,y)=>{const dx=x-ex,dy=y-ey;return Math.atan2((-dx*si+dy*co)/b,(dx*co+dy*si)/a);}});
 if(!(a>=3*scale)||!(b>=2*scale)||a/b>8)return '';
 for(const t of [th,th+Math.PI/2]){const c2=Math.cos(t),s2=Math.sin(t),f=mk(c2,s2),bins=check(f.dist,f.ang,2*a,40);if(!bins)continue;
  if(hiddenOK(bins,u=>[ex+a*Math.cos(u)*c2-b*Math.sin(u)*s2,ey+a*Math.cos(u)*s2+b*Math.sin(u)*c2],2*a))return leanEllipseD(ex,ey,a,b,t,scale);}
 return '';
}
// Poligon dengan sisi lurus dan sudut tajam atau membulat (jari-jari tiap sudut diukur sendiri): persegi, trapesium,
// segitiga, segi enam, panah, juga versi sudut-bulatnya. Sisi yang sebagian tertutup tetap dipakai; sudut yang
// tertutup dicari dari perpotongan dua sisi yang mengapitnya.
function leanPolyArc(pt,scale,cls,cover){
 const n=pt.length;if(n<12)return '';
 const vis=cls?i=>cls[i]===0:()=>true,bad=w=>{if(self.__pg)self.__pg.push('pa'+w+':'+n+'@'+Math.round(pt[0].x)+','+Math.round(pt[0].y));return '';};
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,nE=0;
 for(let i=0;i<n;i++){if(!vis(i))continue;nE++;const p=pt[i];if(p.x<minX)minX=p.x;if(p.x>maxX)maxX=p.x;if(p.y<minY)minY=p.y;if(p.y>maxY)maxY=p.y;}
 if(nE<12)return bad(1);const size=Math.max(maxX-minX,maxY-minY),tolMax=Math.max(.15*scale,Math.min(.3*scale,.006*size,.07*Math.min(maxX-minX,maxY-minY)));
 // ---- deret titik terlihat; kontur yang seluruhnya terlihat dibelah di dua titik terjauhnya
 const runs=[];
 if(nE===n){let i0=0,i1=0,far=-1;for(let i=1;i<n;i++){const d=(pt[i].x-pt[0].x)**2+(pt[i].y-pt[0].y)**2;if(d>far){far=d;i1=i;}}
  far=-1;for(let i=0;i<n;i++){const d=(pt[i].x-pt[i1].x)**2+(pt[i].y-pt[i1].y)**2;if(d>far){far=d;i0=i;}}
  if(i0===i1)return bad(2);runs.push([i0,(i1-i0+n)%n+1],[i1,(i0-i1+n)%n+1]);}
 else{let s=0;while(vis(s))s++;for(let k=1;k<=n;){if(!vis((s+k)%n)){k++;continue;}let e=k;while(e<=n&&vis((s+e)%n))e++;if(e-k>=5)runs.push([(s+k)%n,e-k]);k=e;}}
 // ---- calon sisi lurus pada tiap deret
 const lim=l=>Math.max(.15*scale,Math.min(.32*scale,.008*l));
 // garis kuadrat-terkecil lewat titik terlihat pada indeks a+from .. a+to (mengikuti kontur)
 const lineFit=(a,from,to)=>{let used=0,sx=0,sy=0,xx=0,xy=0,yy=0;for(let q=from;q<=to;q++){const i=(a+q)%n;if(!vis(i))continue;const p=pt[i];used++;sx+=p.x;sy+=p.y;xx+=p.x*p.x;xy+=p.x*p.y;yy+=p.y*p.y;}
  if(used<3)return null;const cx=sx/used,cy=sy/used,an=.5*Math.atan2(2*(xy-cx*cy*used),(xx-cx*cx*used)-(yy-cy*cy*used));let ux=Math.cos(an),uy=Math.sin(an);
  const A=pt[(a+from)%n],B=pt[(a+to)%n];if(ux*(B.x-A.x)+uy*(B.y-A.y)<0){ux=-ux;uy=-uy;}
  // w95: galat yang tidak dilampaui 95% titik (segelintir titik yang bergeser di persilangan tiga warna tidak menggagalkan sisi)
  let worst=0,sum=0,k=0;const res=new Float32Array(used);for(let q=from;q<=to;q++){const i=(a+q)%n;if(!vis(i))continue;const d=Math.abs((pt[i].x-cx)*uy-(pt[i].y-cy)*ux);res[k++]=d;if(d>worst)worst=d;sum+=d*d;}
  res.sort();return {cx,cy,ux,uy,worst,w95:res[Math.min(used-1,Math.floor(used*.95))],rms:Math.sqrt(sum/used),used};};
 // sisi dari titik a .. a+c: inti = setengah bagian tengah, lalu diperluas ke kedua arah selama titiknya masih segaris
 const makeSide=(a,c)=>{if(c<5)return null;const A=pt[a],B=pt[(a+c)%n],chord=Math.hypot(B.x-A.x,B.y-A.y);if(chord<3*scale)return null;
  let from=Math.floor(c/4),to=c-Math.floor(c/4);if(to-from<2)return null;let L=lineFit(a,from,to);if(!L)return null;
  const F=pt[(a+from)%n],T=pt[(a+to)%n],l0=lim(Math.hypot(T.x-F.x,T.y-F.y));if(L.w95>l0||L.worst>3*l0||L.rms>.5*l0){if(self.__padbg&&chord>50*scale)console.log('   inti gagal: tali',chord.toFixed(0),'maks',L.worst.toFixed(2),'rms',L.rms.toFixed(2),'batas',l0.toFixed(2),'n',n);return null;}
  for(let pass=0;pass<2;pass++){const ext=Math.max(.2*scale,l0),ok=q=>{const i=(a+q)%n;if(!vis(i))return true;const p=pt[i];return Math.abs((p.x-L.cx)*L.uy-(p.y-L.cy)*L.ux)<=ext;};
   while(from>0&&ok(from-1))from--;while(to<c&&ok(to+1))to++;while(from<to&&!vis((a+from)%n))from++;while(to>from&&!vis((a+to)%n))to--;
   L=lineFit(a,from,to);if(!L)return null;}
  const p0=pt[(a+from)%n],p1=pt[(a+to)%n],len=(p1.x-p0.x)*L.ux+(p1.y-p0.y)*L.uy;if(len<4*scale||len<.35*chord||L.w95>Math.max(.2*scale,lim(len))*1.5||L.worst>4*Math.max(.2*scale,lim(len)))return null;
  return {...L,a:(a+from)%n,cnt:to-from+1,len};};
 const sides=[];
 for(const [start,count] of runs){
  const P=q=>pt[(start+q)%n],keep=[0,count-1],stack=[[0,count-1]];
  while(stack.length){const [a,b]=stack.pop(),A=P(a),B=P(b),dx=B.x-A.x,dy=B.y-A.y,l=Math.hypot(dx,dy)||1;let worst=1.2*scale,at=-1;
   for(let q=a+1;q<b;q++){const d=Math.abs((P(q).x-A.x)*dy-(P(q).y-A.y)*dx)/l;if(d>worst){worst=d;at=q;}}
   if(at>=0){keep.push(at);if(keep.length>60)return bad(3);stack.push([a,at],[at,b]);}}
  keep.sort((a,b)=>a-b);
  for(let k=0;k+1<keep.length;k++){const side=makeSide((start+keep[k])%n,keep[k+1]-keep[k]);if(side)sides.push(side);}}
 if(self.__padbg)console.log('  sisi',sides.length,sides.map(s=>s.len.toFixed(0)+'@'+s.a+'+'+s.cnt).join(' '),'| deret',runs.map(r=>r.join('+')).join(' '),'n',n,'tol',tolMax.toFixed(2));
 if(sides.length<3)return bad(4);
 // urut mengikuti kontur
 const base=sides[0].a;sides.sort((p,q)=>((p.a-base+n)%n)-((q.a-base+n)%n));
 // Dua potong sisi yang segaris dijadikan satu bila di antaranya hanya ada bagian tertutup, atau nyaris tanpa jarak
 // (sisi yang terbelah oleh awal deret atau oleh titik belah penyederhanaan). Sisi gabungan dicocokkan ulang dari intinya.
 const gapHidden=(s,t)=>{let c=0;for(let i=(s.a+s.cnt)%n;i!==t.a;i=(i+1)%n){if(!vis(i))return true;c++;}return c<=Math.max(3,Math.round(3*scale));};
 const mergeLine=()=>{for(let again=true;again&&sides.length>3;){again=false;
  for(let k=0;k<sides.length;k++){const j=(k+1)%sides.length,s=sides[k],t=sides[j];
   // segaris: kedua ujung potongan yang lebih pendek terletak pada garis potongan yang lebih panjang
   const cross=s.ux*t.uy-s.uy*t.ux,dot=s.ux*t.ux+s.uy*t.uy,ahead=(t.cx-s.cx)*s.ux+(t.cy-s.cy)*s.uy,G=s.len>=t.len?s:t,K=G===s?t:s,e0=pt[K.a],e1=pt[(K.a+K.cnt-1)%n],
    o1=Math.abs((e0.x-G.cx)*G.uy-(e0.y-G.cy)*G.ux),o2=Math.abs((e1.x-G.cx)*G.uy-(e1.y-G.cy)*G.ux);
   if(dot>0&&Math.abs(cross)<(K.len<G.len*.4?.2:.05)&&Math.max(o1,o2)<Math.max(.4*scale,tolMax)&&ahead>0&&gapHidden(s,t)){
    const re=makeSide(s.a,(t.a+t.cnt-1-s.a+n)%n);if(!re)continue;sides[k]=re;sides.splice(j,1);again=true;break;}}}};
 mergeLine();
 // Busur sudut yang landai ikut terbaca sebagai beberapa "sisi" pendek yang berbelok sedikit demi sedikit. Sisi pendek
 // yang belokannya ke salah satu tetangga di bawah 40 derajat dianggap bagian busur, bukan sisi (talang 45 derajat tetap sisi).
 {const weak=Math.max(8*scale,.1*size),turn=(p,q)=>Math.abs(Math.atan2(p.ux*q.uy-p.uy*q.ux,p.ux*q.ux+p.uy*q.uy)),drop=new Set();
  const gap=(s,t)=>{let c=0;for(let i=(s.a+s.cnt)%n;i!==t.a&&c<1e4;i=(i+1)%n)c++;return c;},wide=4*scale;
  // juga: sisi pendek yang diapit bagian melengkung (banyak titik di antara dia dan tetangganya) adalah tali busur
  for(let k=0;k<sides.length;k++){const s=sides[k];if(s.len>=weak)continue;const p=sides[(k+sides.length-1)%sides.length],q=sides[(k+1)%sides.length];if(Math.min(turn(p,s),turn(s,q))<.7||gap(p,s)>wide||gap(s,q)>wide)drop.add(s);}
  if(drop.size){const kept=sides.filter(s=>!drop.has(s));sides.length=0;sides.push(...kept);}
  if(sides.length<3)return bad(15);}
 mergeLine();
 // Tiap sisi diperluas sekali lagi sepanjang kontur (tidak lagi dibatasi titik belah penyederhanaan) sampai titiknya
 // meninggalkan garis atau menyentuh sisi tetangga; kalau tidak, bagian lurus yang tertinggal mengacaukan ukuran jari-jari sudut.
 for(let k=0;k<sides.length;k++){let S=sides[k];const prev=sides[(k+sides.length-1)%sides.length],next=sides[(k+1)%sides.length];
  for(let pass=0;pass<2;pass++){const ext=Math.max(.2*scale,lim(S.len)),on=i=>{const p=pt[i];return Math.abs((p.x-S.cx)*S.uy-(p.y-S.cy)*S.ux)<=ext;};
   let a=S.a,cnt=S.cnt;const stopB=(prev.a+prev.cnt-1)%n,stopF=next.a;
   for(let i=(a-1+n)%n;i!==stopB&&vis(i)&&on(i)&&cnt<n-2;i=(i-1+n)%n){a=i;cnt++;}
   for(let i=(a+cnt)%n;i!==stopF&&vis(i)&&on(i)&&cnt<n-2;i=(i+1)%n)cnt++;
   if(a===S.a&&cnt===S.cnt)break;const L=lineFit(a,0,cnt-1);if(!L)break;const p0=pt[a],p1=pt[(a+cnt-1)%n];S=sides[k]={...L,a,cnt,len:(p1.x-p0.x)*L.ux+(p1.y-p0.y)*L.uy};}}
 if(self.__padbg)console.log('  akhir',sides.map(s=>s.len.toFixed(0)+'@'+s.a+'+'+s.cnt+' arah '+(Math.atan2(s.uy,s.ux)*180/Math.PI).toFixed(1)).join(' | '));
 let m=sides.length;if(m<3||m>40)return bad(5);
 for(const s of sides){const len=Math.hypot(maxX-minX,maxY-minY);if(Math.abs(s.uy)*s.len<.3*scale&&Math.abs(s.uy)<.01){s.ux=Math.sign(s.ux);s.uy=0;}else if(Math.abs(s.ux)*s.len<.3*scale&&Math.abs(s.ux)<.01){s.uy=Math.sign(s.uy);s.ux=0;}
  const p0=pt[s.a],p1=pt[(s.a+s.cnt-1)%n];s.t0=(p0.x-s.cx)*s.ux+(p0.y-s.cy)*s.uy;s.t1=(p1.x-s.cx)*s.ux+(p1.y-s.cy)*s.uy;}
 // Dua sisi yang mengapit bagian tertutup tetapi tidak bertemu di satu titik sudut di bawah penutup (misalnya persegi yang
 // terpotong melintang): bentuk ditutup dengan satu sisi lurus tersembunyi, sedikit masuk ke bawah penutup.
 if(cls){const near0=leanNear(pt,cls,scale),free=(x,y)=>cover(x,y)||near0(x,y,1.5*scale),path=(x0,y0,x1,y1)=>{const st=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/scale));for(let q=0;q<=st;q++)if(!free(x0+(x1-x0)*q/st,y0+(y1-y0)*q/st))return false;return true;};
  for(let k=0;k<sides.length;k++){const A=sides[k],B=sides[(k+1)%sides.length];if(A.virtual||B.virtual)continue;let hidden=false;for(let i=(A.a+A.cnt)%n;i!==B.a;i=(i+1)%n)if(!vis(i)){hidden=true;break;}if(!hidden)continue;
   const cross=A.ux*B.uy-A.uy*B.ux;let meet=false;
   if(Math.abs(cross)>=.2){const t=((B.cx-A.cx)*B.uy-(B.cy-A.cy)*B.ux)/cross,x=A.cx+t*A.ux,y=A.cy+t*A.uy,tb=(x-B.cx)*B.ux+(y-B.cy)*B.uy;
    meet=t>=A.t1-1.5*scale&&tb<=B.t0+1.5*scale&&path(A.cx+A.t1*A.ux,A.cy+A.t1*A.uy,x,y)&&path(x,y,B.cx+B.t0*B.ux,B.cy+B.t0*B.uy);}
   if(meet)continue;
   // maju sepanjang sisi sampai benar-benar masuk ke bawah penutup, lalu 1,5 px lagi
   const dive=(S,t,dir)=>{for(let q=0;q<=24;q++){const z=t+dir*q*.5*scale;if(cover(S.cx+z*S.ux,S.cy+z*S.uy)){const e=z+dir*1.5*scale;return cover(S.cx+e*S.ux,S.cy+e*S.uy)?e:z;}}return null;},ta=dive(A,A.t1,1),tb2=dive(B,B.t0,-1);if(ta===null||tb2===null)return bad(16);
   const ax=A.cx+ta*A.ux,ay=A.cy+ta*A.uy,bx=B.cx+tb2*B.ux,by=B.cy+tb2*B.uy,len=Math.hypot(bx-ax,by-ay);if(len<scale||!path(ax,ay,bx,by))return bad(16);
   sides.splice(k+1,0,{virtual:true,cx:ax,cy:ay,ux:(bx-ax)/len,uy:(by-ay)/len,t0:0,t1:len,len,a:-1,cnt:0});k++;}
  m=sides.length;}
 // ---- sudut: perpotongan dua sisi berurutan, jari-jari dari titik terlihat di antaranya
 const V=[];
 for(let k=0;k<m;k++){const A=sides[k],B=sides[(k+1)%m],cross=A.ux*B.uy-A.uy*B.ux,dot=A.ux*B.ux+A.uy*B.uy;if(Math.abs(cross)<.2)return bad(6);
  const t=((B.cx-A.cx)*B.uy-(B.cy-A.cy)*B.ux)/cross,x=A.cx+t*A.ux,y=A.cy+t*A.uy,tb=((x-B.cx)*B.ux+(y-B.cy)*B.uy);
  // titik sudut berada di depan ujung sisi A dan di belakang awal sisi B
  if(t<A.t1-1.5*scale||tb>B.t0+1.5*scale){if(self.__padbg)console.log('  pa7 k',k,'t',t.toFixed(1),'A.t1',A.t1.toFixed(1),'tb',tb.toFixed(1),'B.t0',B.t0.toFixed(1),'cross',cross.toFixed(2),'| sisi',sides.map(s=>s.len.toFixed(0)+'@'+s.a+'+'+s.cnt).join(' '),'n',n);return bad(7);}
  const theta=Math.atan2(Math.abs(cross),dot),half=Math.cos(theta/2),tan=Math.tan(theta/2);let bx=B.ux-A.ux,by=B.uy-A.uy;const bl=Math.hypot(bx,by)||1;bx/=bl;by/=bl;
  const G=[];let hidden=!!(A.virtual||B.virtual);if(!hidden)for(let i=(A.a+A.cnt)%n;i!==B.a;i=(i+1)%n){if(vis(i))G.push(pt[i]);else hidden=true;}
  let r=hidden?-1:0;
  if(!hidden&&G.length>=3){const rmax=Math.min(t-A.t0,B.t1-tb)/tan,cost=r=>{const cx=x+r/half*bx,cy=y+r/half*by;let s=0;for(const p of G){const e=Math.hypot(p.x-cx,p.y-cy)-r;s+=e*e;}return s;};
   let lo=0,hi=Math.max(0,rmax);for(let it=0;it<40;it++){const m1=lo+(hi-lo)*.382,m2=lo+(hi-lo)*.618;if(cost(m1)<cost(m2))hi=m2;else lo=m1;}r=(lo+hi)/2;
   // sudut yang jari-jarinya di bawah ~1,75 px tidak terbedakan dari sudut tajam yang dihaluskan antialias
   if(r<1.75*scale)r=0;}
  V.push({x,y,r,theta,half,tan,bx,by,hidden,virtual:!!(A.virtual||B.virtual),room:Math.min(t-A.t0,B.t1-tb)});}
 // jari-jari yang seragam disamakan; sudut tertutup mengikuti sudut lain bila semuanya seragam
 {const R=V.filter(v=>v.r>0).map(v=>v.r),all=V.filter(v=>!v.hidden);if(R.length>=2){const mean=R.reduce((a,b)=>a+b,0)/R.length,spread=Math.max(...R)-Math.min(...R);
   if(spread<=Math.max(.6*scale,.12*mean)){for(const v of V)if(v.r>0)v.r=mean;if(R.length===all.length)for(const v of V)if(v.r<0&&!v.virtual&&mean*v.tan<=v.room)v.r=mean;}}
  for(const v of V)if(v.r<0)v.r=0;}
 if(self.__padbg)console.log('  sudut',V.map(v=>'r'+v.r.toFixed(1)+(v.hidden?'h':'')+' θ'+(v.theta*180/Math.PI).toFixed(0)+' room'+v.room.toFixed(0)).join(' | '));
 for(let k=0;k<m;k++){const v=V[k],w=V[(k+m-1)%m],L=Math.hypot(v.x-w.x,v.y-w.y);v.t=v.r*v.tan;if(L<2*scale)return bad(8);}
 for(let k=0;k<m;k++){const v=V[k],w=V[(k+m-1)%m],L=Math.hypot(v.x-w.x,v.y-w.y);if(v.t+w.t>L+.5*scale)return bad(9);}
 // ---- unsur bentuk: garis dari ujung busur sebelumnya ke awal busur berikutnya, lalu busur
 for(let k=0;k<m;k++){const v=V[k],A=sides[k],B=sides[(k+1)%m];v.p1=[v.x-v.t*A.ux,v.y-v.t*A.uy];v.p2=[v.x+v.t*B.ux,v.y+v.t*B.uy];v.cx=v.x+v.r/v.half*v.bx;v.cy=v.y+v.r/v.half*v.by;v.cosHalf=Math.cos(v.theta/2);
  v.zone=Math.min(6,1.5/Math.max(.2,v.half)+1.5)*scale;v.allow=Math.min(2.2,.55/Math.max(.2,v.half))*scale;}
 const dist=(px,py)=>{let best=Infinity;
  for(let k=0;k<m;k++){const v=V[k],w=V[(k+m-1)%m],ax=w.p2[0],ay=w.p2[1],dx=v.p1[0]-ax,dy=v.p1[1]-ay,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l)):0,e=Math.hypot(px-ax-t*dx,py-ay-t*dy);if(e<best)best=e;
   if(v.r>0){const qx=px-v.cx,qy=py-v.cy,q=Math.hypot(qx,qy)||1;if(-(qx*v.bx+qy*v.by)>=v.cosHalf*q-1e-9){const e2=Math.abs(q-v.r);if(e2<best)best=e2;}}}
  return best;};
 // titik terlihat harus dijelaskan bentuk itu (sudut tajam boleh sedikit tumpul di gambar asal)
 let worst=0,sum=0,cnt=0,stray=0;
 for(let i=0;i<n;i++){if(!vis(i))continue;const p=pt[i];let e=dist(p.x,p.y);
  if(e>tolMax){let ok=false;for(const v of V)if(v.r===0&&!v.hidden&&Math.hypot(p.x-v.x,p.y-v.y)<v.zone&&e<v.allow){ok=true;break;}
   // segelintir titik yang bergeser (persilangan dengan bentuk lain) dimaafkan selama tidak jauh
   if(!ok&&e<=3*tolMax&&++stray<=Math.max(4,.02*nE))ok=true;
   if(!ok){if(self.__padbg)console.log('  titik gagal',p.x.toFixed(1),p.y.toFixed(1),'e',e.toFixed(2));return bad(10);}e=tolMax;}
  if(e>worst)worst=e;sum+=e*e;cnt++;}
 if(Math.sqrt(sum/cnt)>.6*tolMax)return bad(11);
 // tiap bagian bentuk baru harus berupa tepi yang terlihat atau berada di bawah penutup
 const nearE=leanNear(pt,cls,scale);
 const okAt=(x,y,lim)=>nearE(x,y,lim)||(cover?cover(x,y):false);
 for(let k=0;k<m;k++){const v=V[k],w=V[(k+m-1)%m],dx=v.p1[0]-w.p2[0],dy=v.p1[1]-w.p2[1],steps=Math.ceil(Math.hypot(dx,dy)/scale);
  for(let q=0;q<=steps;q++){const x=w.p2[0]+dx*q/Math.max(1,steps),y=w.p2[1]+dy*q/Math.max(1,steps);let lim=1.5*scale;for(const z of [v,w])if(z.r===0&&Math.hypot(x-z.x,y-z.y)<z.zone)lim=Math.max(lim,z.allow+scale);if(!okAt(x,y,lim))return bad(12);}
  if(v.r>0){const a0=Math.atan2(v.p1[1]-v.cy,v.p1[0]-v.cx),sw=sides[k].ux*sides[(k+1)%m].uy-sides[k].uy*sides[(k+1)%m].ux>0?1:-1,st=Math.max(2,Math.ceil(v.r*v.theta/scale));for(let q=1;q<st;q++){const an=a0+sw*v.theta*q/st;if(!okAt(v.cx+v.r*Math.cos(an),v.cy+v.r*Math.sin(an),1.5*scale))return bad(13);}}}
 // selisih antara kontur lama dan bentuk baru harus seluruhnya di bawah penutup
 if(cls){const poly=[];for(let k=0;k<m;k++){const v=V[k];poly.push(v.p1);if(v.r>0){const a0=Math.atan2(v.p1[1]-v.cy,v.p1[0]-v.cx),sw=sides[k].ux*sides[(k+1)%m].uy-sides[k].uy*sides[(k+1)%m].ux>0?1:-1,st=Math.max(2,Math.ceil(v.r*v.theta/scale));for(let q=1;q<=st;q++){const an=a0+sw*v.theta*q/st;poly.push([v.cx+v.r*Math.cos(an),v.cy+v.r*Math.sin(an)]);}}}
  if(!leanXorOK(pt,cls,poly,scale,cover))return bad(14);}
 // ---- tulis: garis ke awal busur, busur (satu kubik sampai 100 derajat, dua bila lebih)
 const f=v=>+v.toFixed(2),P=p=>f(p[0])+' '+f(p[1]);let d='M '+P(V[m-1].p2),cur=V[m-1].p2;
 for(let k=0;k<m;k++){const v=V[k],A=sides[k],B=sides[(k+1)%m],last=k===m-1;
  if(v.r===0){if(!last)d+=' L '+P([v.x,v.y]);cur=[v.x,v.y];continue;}
  if(Math.hypot(v.p1[0]-cur[0],v.p1[1]-cur[1])>.05)d+=' L '+P(v.p1);cur=v.p2;
  const arc=(p1,u1,p2,u2,th)=>{const h=4/3*Math.tan(th/4)*v.r;d+=' C '+P([p1[0]+h*u1[0],p1[1]+h*u1[1]])+' '+P([p2[0]-h*u2[0],p2[1]-h*u2[1]])+' '+P(p2);};
  if(2.7e-4*Math.pow(v.theta/1.5708,6)*v.r<=.08*scale)arc(v.p1,[A.ux,A.uy],v.p2,[B.ux,B.uy],v.theta);
  else{const mx=v.cx-v.r*v.bx,my=v.cy-v.r*v.by;let tx=A.ux+B.ux,ty=A.uy+B.uy;const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;arc(v.p1,[A.ux,A.uy],[mx,my],[tx,ty],v.theta/2);arc([mx,my],[tx,ty],v.p2,[B.ux,B.uy],v.theta/2);}}
 return d+' Z';
}
function leanPartial(pt,scale,cls,cover){return leanRoundPartial(pt,scale,cls,cover)||leanPolyArc(pt,scale,cls,cover);}
// ===== VektorKu V2 Pro 1.47: ujung runcing =====
// Ujung bentuk yang meruncing (helai rambut, ujung alis, duri, sudut lancip) pada piksel tinggal selebar 1-2 piksel,
// sehingga penelusur menutupnya dengan setengah lingkaran: ujungnya tumpul. Di sini tiap kontur dicari "tutup"-nya:
// bagian pendek tempat kurva berbalik arah (>= 150 derajat) di antara dua sisi yang saling mendekat seperti baji.
// Garis kedua sisi diperpanjang sampai bertemu; ujung baru dipasang sejauh gambar asli memang masih menunjukkan warna
// bentuk itu (dibaca dari medan cakupan), tidak lebih jauh dari titik temu kedua sisi. Ujung bulat sungguhan (ujung
// goresan yang sisinya sejajar) tidak disentuh. Berlaku juga untuk celah lancip (kontur lubang).
function tipsParse(d){
 const tok=d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);if(!tok)return null;const segs=[];let i=0,cur=null,start=null,cmd='';
 while(i<tok.length){const t=tok[i];if(/^[MLCZ]$/i.test(t)){cmd=t.toUpperCase();i++;if(cmd==='Z'){if(cur&&start&&(Math.abs(cur[0]-start[0])>1e-6||Math.abs(cur[1]-start[1])>1e-6))segs.push(tipsLine(cur,start));cur=start;}continue;}
  if(cmd==='M'){if(start)return null;cur=[+tok[i],+tok[i+1]];start=cur;i+=2;cmd='L';continue;}
  if(cmd==='L'){const p=[+tok[i],+tok[i+1]];segs.push(tipsLine(cur,p));cur=p;i+=2;continue;}
  if(cmd==='C'){const a=[+tok[i],+tok[i+1]],b=[+tok[i+2],+tok[i+3]],p=[+tok[i+4],+tok[i+5]];segs.push({p0:cur,c1:a,c2:b,p3:p,line:false});cur=p;i+=6;continue;}
  return null;}
 if(cur&&start&&(Math.abs(cur[0]-start[0])>1e-6||Math.abs(cur[1]-start[1])>1e-6))segs.push(tipsLine(cur,start));
 return segs.length>=3?segs:null;}
function tipsLine(a,b){return {p0:a,c1:[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],c2:[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],p3:b,line:true};}
function tipsAt(s,t){const u=1-t;return [u*u*u*s.p0[0]+3*u*u*t*s.c1[0]+3*u*t*t*s.c2[0]+t*t*t*s.p3[0],u*u*u*s.p0[1]+3*u*u*t*s.c1[1]+3*u*t*t*s.c2[1]+t*t*t*s.p3[1]];}
function tipsSplit(s,t){const L=(a,b)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],a=L(s.p0,s.c1),b=L(s.c1,s.c2),c=L(s.c2,s.p3),d=L(a,b),e=L(b,c),f=L(d,e);
 return [{p0:s.p0,c1:a,c2:d,p3:f,line:s.line},{p0:f,c1:e,c2:c,p3:s.p3,line:s.line}];}
function sharpenTips(d,field,W,H,scale,opt){
 opt=opt||{};const segs=tipsParse(d);if(!segs)return d;const S=10,P=[];
 for(let k=0;k<segs.length;k++)for(let q=0;q<S;q++){const t=q/S;P.push({xy:tipsAt(segs[k],t),k,t});}
 const n=P.length;if(n<20)return d;const arc=new Float64Array(n+1);for(let i=1;i<=n;i++){const a=P[i-1].xy,b=P[i%n].xy;arc[i]=arc[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1]);}
 const total=arc[n];if(total<8*scale)return d;
 const ang=new Float64Array(n);for(let i=0;i<n;i++){const a=P[i].xy,b=P[(i+1)%n].xy;ang[i]=Math.atan2(b[1]-a[1],b[0]-a[0]);}
 const turn=new Float64Array(n);for(let i=0;i<n;i++){let x=ang[(i+1)%n]-ang[i];while(x>Math.PI)x-=2*Math.PI;while(x<-Math.PI)x+=2*Math.PI;turn[i]=x;}
 let orient=0;for(let i=0;i<n;i++)orient+=turn[i];const sg=orient>=0?1:-1;
 const capMax=(opt.capMax??5)*scale,need=(opt.capTurn??150)*Math.PI/180,fl=(opt.flank??4)*scale,maxExt=(opt.maxExt??6)*scale,thr=opt.thr??.3;
 const val=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y);if(ix<0||iy<0||ix>=W||iy>=H)return -1;return field(iy*W+ix);};
 const at=(s)=>{s=((s%total)+total)%total;let lo=0,hi=n;while(hi-lo>1){const m=(lo+hi)>>1;if(arc[m]<=s)lo=m;else hi=m;}const a=P[lo].xy,b=P[(lo+1)%n].xy,f=(s-arc[lo])/((arc[lo+1]-arc[lo])||1);return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];};
 const caps=[];
 for(let i=0;i<n;i++){let sum=0;for(let j=i;j<i+n&&arc[j]-arc[i]<=capMax;j++){sum+=turn[j%n];if(Math.abs(sum)>=need){
    // tutup harus berbelok ke arah yang sama dengan kontur (cembung)
    if(sum*sg<=0)break;caps.push({i,j,len:arc[j]-arc[i]});break;}}}
 caps.sort((a,b)=>a.len-b.len);const used=new Uint8Array(n),pick=[];
 for(const c of caps){let free=true;for(let q=c.i-2;q<=c.j+2;q++)if(used[((q%n)+n)%n]){free=false;break;}if(!free)continue;for(let q=c.i;q<=c.j;q++)used[q%n]=1;pick.push(c);}
 if(!pick.length)return d;
 const cuts=[];
 for(const c of pick){if(c.j>=n)continue;// tutup yang melintasi titik awal kontur dilewati
  const sA=arc[c.i],sB=arc[c.j],A=P[c.i].xy,B=P[c.j].xy,A0=at(sA-fl),B0=at(sB+fl);
  let ux=A[0]-A0[0],uy=A[1]-A0[1],vx=B[0]-B0[0],vy=B[1]-B0[1];const lu=Math.hypot(ux,uy),lv=Math.hypot(vx,vy);if(lu<.5*fl||lv<.5*fl)continue;ux/=lu;uy/=lu;vx/=lv;vy/=lv;
  // kedua sisi harus saling mendekat (baji), bukan sejajar (ujung goresan bulat)
  const cr=ux*vy-uy*vx;if(Math.abs(cr)<(opt.minWedge??.12))continue;
  const bx=B[0]-A[0],by=B[1]-A[1],sA2=(bx*vy-by*vx)/cr,sB2=(bx*uy-by*ux)/cr;if(sA2<=0||sB2<=0)continue;
  const X=[A[0]+ux*sA2,A[1]+uy*sA2];
  // puncak sekarang = titik tutup terjauh ke arah ujung
  let ax=ux+vx,ay=uy+vy;const la=Math.hypot(ax,ay);if(la<1e-6)continue;ax/=la;ay/=la;
  let apex=null,best=-Infinity;for(let q=c.i;q<=c.j;q++){const p=P[q%n].xy,pr=p[0]*ax+p[1]*ay;if(pr>best){best=pr;apex=p;}}
  const reach=(X[0]-apex[0])*ax+(X[1]-apex[1])*ay;if(reach<.3*scale)continue;
  if(opt.hidden&&opt.hidden(apex[0],apex[1]))continue;
  if(opt.skip&&opt.skip(apex[0],apex[1]))continue;
  // sisi dalam tutup: titik tengah tali busur A-B (di dalam bentuk untuk tonjolan, di luar untuk celah)
  const cin=val((A[0]+B[0])/2,(A[1]+B[1])/2);if(cin<0)continue;
  const lim=Math.min(reach,maxExt);let ext=0;
  for(let e=.5;e<=lim+1e-6;e+=.5){const v=val(apex[0]+ax*e,apex[1]+ay*e);if(v<0||Math.abs(v-cin)>1-thr)break;ext=e;}
  if(ext<(opt.minExt??.5)*scale)continue;
  const T=ext>=reach-.25?X:[apex[0]+ax*ext,apex[1]+ay*ext];
  cuts.push({i:c.i,j:c.j,tip:T});}
 if(!cuts.length)return d;
 // susun ulang: segmen dipotong di titik awal dan akhir tiap tutup, tutup diganti dua garis lurus ke ujung baru
 cuts.sort((a,b)=>a.i-b.i);const f=v=>String(+v.toFixed(2)),out=[];
 const pos=q=>({k:P[q].k,t:P[q].t});let k=0,t0=0;const emit=s=>out.push(s.line?`L${f(s.p3[0])} ${f(s.p3[1])}`:`C${f(s.c1[0])} ${f(s.c1[1])} ${f(s.c2[0])} ${f(s.c2[1])} ${f(s.p3[0])} ${f(s.p3[1])}`);
 const startPt=segs[0].p0;let cursor={k:0,t:0};
 const piece=(from,to)=>{// segmen dari posisi from ke to (to sesudah from)
  for(let q=from.k;q<=to.k;q++){let s=segs[q];const a=q===from.k?from.t:0,b=q===to.k?to.t:1;if(b<=a+1e-9)continue;
   if(a>0){const r=tipsSplit(s,a);s=r[1];}
   if(b<1){const bb=a>0?(b-a)/(1-a):b;s=tipsSplit(s,bb)[0];}
   emit(s);}};
 for(const c of cuts){const A=pos(c.i),B=pos(c.j);piece(cursor,A);out.push(`L${f(c.tip[0])} ${f(c.tip[1])}`);const Bp=P[c.j].xy;out.push(`L${f(Bp[0])} ${f(Bp[1])}`);cursor=B;}
 piece(cursor,{k:segs.length-1,t:1});
 if(self.__tips)self.__tips.push(...cuts.map(c=>[+c.tip[0].toFixed(1),+c.tip[1].toFixed(1)]));
 return `M${f(startPt[0])} ${f(startPt[1])}`+out.join('')+'Z';
}
function preciseLogoPath(mask,w,h,scale,color,s,baseTolerance=.15,field=null,box=null){
 const params=logoTraceParams(s,scale);
 const t=new PotraceBrowser.Potrace({threshold:128,turdSize:params.turdSize,alphaMax:params.alphaMax,optCurve:true,optTolerance:.15*scale});
 if(detailKeep&&detailKeep.w===w&&detailKeep.h===h&&params.turdSize>0){const K=detailKeep.data,ox=box?box.x:0,oy=box?box.y:0;t._keep=path=>{for(let y=Math.max(0,path.minY);y<=path.maxY;y++){const row=(y+oy)*w+ox;for(let x=Math.max(0,path.minX);x<=path.maxX;x++)if(K[row+x])return true;}return false;};}
 // box: hanya bagian mask ini yang ditelusuri; titik hasilnya digeser kembali ke koordinat gambar
 const bw=box?box.w:w,bh=box?box.h:h,bx=box?box.x:0,by=box?box.y:0,local=box&&field?j=>field((((j/bw)|0)+by)*w+j%bw+bx):field;
 const shift=path=>{if(!bx&&!by)return;for(const p of path.pt){p.x+=bx;p.y+=by;}if(path.lattice)for(const p of path.lattice){p.x+=bx;p.y+=by;}};
 if(field){t._refinePoints=path=>{subpixelPoints(path,local,bw,bh,scale,s.mode!=='bw');shift(path);};if(s.geometry!==false&&s.straight!==false)t._refineVertices=path=>straightenEdges(path,scale,s.corners!==false,s.tangent!==false,s.lineTol||3);}
 else if(box)t._refinePoints=shift;
 const bm=new PotraceBrowser.Bitmap(bw,bh);if(box)for(let y=0;y<bh;y++){const row=(y+by)*w+bx,o=y*bw;for(let x=0;x<bw;x++)bm.data[o+x]=mask[row+x]?0:255;}else for(let i=0;i<mask.length;i++)bm.data[i]=mask[i]?0:255;t._luminanceData=bm;t._imageLoaded=true;t._bmToPathlist();
 const paths=t._pathlist,out=[],fragments=[];
 for(const path of paths){
  const span=Math.min(path.maxX-path.minX,path.maxY-path.minY);
  t._params.optTolerance=(span<24*scale?Math.min(baseTolerance,.055):baseTolerance)*scale*params.tolerance;
  t._pathlist=[path];t._processPath();t._processed=true;
  let base=renderLogoCurve(path.curve),polygon='';
  // bentuk geometri; kontur yang sebagian tertutup lapisan lain dikenali dari bagian yang terlihat
  let shape='';
  if(field&&s.mode!=='bw'&&s.geometry!==false&&s.shapes!==false&&path.pt.length<=6000){
   let cls=null;if(leanClass&&path.lattice){const n=path.pt.length;cls=new Uint8Array(n);let any=0;for(let i=0;i<n;i++){const c=leanClass(path.lattice[i].x,path.lattice[i].y);cls[i]=c;if(c)any++;}if(!any)cls=null;
    // titik terlihat tepat di sebelah sambungan ikut tidak dipakai: di sana tiga warna bercampur dan letak tepinya bergeser
    else{const k=Math.round(2*scale)+1,near=new Uint8Array(n);for(let i=0;i<n;i++)if(cls[i])for(let q=-k;q<=k;q++)near[(i+q+n)%n]=1;for(let i=0;i<n;i++)if(!cls[i]&&near[i])cls[i]=3;}}
   shape=cls?(s.partial===false?'':leanPartial(path.pt,scale,cls,leanCover)):leanGeometry(path.pt,scale);
   // potongan yang sebagian tertutup dan belum dikenali disimpan: mungkin satu lingkaran yang terbelah bentuk lain
   if(cls&&!shape&&s.partial!==false&&fragments.length<24)fragments.push({at:out.length,pt:path.pt,cls});
  }
  if(s.geometry!==false&&path.pt.length>=24&&path.pt.length<=4000&&span>=8*scale){
   polygon=geometricPolygon(path.pt);
   if(polygon){const nums=polygon.match(/-?\d+(?:\.\d+)?/g).map(Number),p=[];for(let i=0;i<nums.length;i+=2)p.push([nums[i],nums[i+1]]);
    // A stricter bound than the general illustration polygon fitter.
    if(path.pt.some(v=>Math.min(...p.map((a,i)=>distanceSegment([v.x,v.y],a,p[(i+1)%p.length])))>.65*scale))polygon='';
   }
  }
  if(!polygon&&s.refineMono&&s.quality!=='simple'){
   const candidate=refineMonoBezier(path.curve,path.pt,scale,path.lattice||path.pt);
   if(candidate){path.curve=candidate;base=renderLogoCurve(path.curve);}
  }
  if(!polygon&&s.lean!==false){const soft=(s.leanSoftAt??.82)-(path.sharpness??1),small=soft<0?Math.max(s.leanSmall??.6,Math.min(1,span/(24*scale))):1,lean=leanPath(path.curve,scale,{tol:Math.max(.6*(s.leanTol??(s.quality==='simple'?.6:.3)),Math.min((s.leanTol??(s.quality==='simple'?.6:.3))+(soft>0?s.leanSoft??1:s.leanCrisp??1.5)*soft,Math.max(.55,s.leanTol??.3)))*scale*params.tolerance*small,hardLen:(s.leanLine??8)*scale,tolLine:(s.leanLineTol??.1)*scale,angle:s.leanAngle??.14,move:s.leanMove,refit:s.leanRefit,truth:field&&s.leanTruth!==false?path.pt:null,hidden:s.leanHide===false?null:leanHidden,tolHidden:(s.leanHidden??.5)*Math.max(2,Math.round(1.5*scale))});if(lean)base=lean;}
  // bentuk geometri dipakai bila memang bentuk besar, atau tidak lebih boros daripada kurva biasa
  const useShape=shape&&(span>=(s.shapeMin??20)*scale||leanCount(shape)<=leanCount(polygon||base)+2);
  if(self.__pts&&field)self.__pts.push({d:useShape?shape:polygon||base,kind:useShape?'bentuk':polygon?'poligon':'kurva',pt:path.pt.map(p=>[p.x,p.y,leanHidden&&leanHidden(p.x,p.y)?1:0])});
  if(useShape){out.push(shape);continue;}
  if(!polygon&&field&&s.tips!==false&&s.mode!=='bw'){try{base=sharpenTips(base,field,w,h,scale,{hidden:leanHidden,skip:s.noTip&&s.noTip.length?(x,y)=>s.noTip.some(b=>x>=b[0]*scale&&x<(b[2]+1)*scale&&y>=b[1]*scale&&y<(b[3]+1)*scale):null,maxExt:(s.tipMax??6)*scale,minWedge:s.tipWedge??.35,thr:s.tipThr??.4,minExt:s.tipMinExt??.75});}catch(e){}}
  out.push(polygon||base);
 }
 // Lingkaran atau elips yang terbelah menjadi beberapa potong (garis melintang di atasnya): potongan-potongan yang
 // busur terlihatnya terletak pada satu lingkaran yang sama digambar sebagai satu lingkaran utuh di bawah penutupnya.
 if(fragments.length>1&&leanCover){const used=new Set();
  for(let i=0;i<fragments.length;i++){if(used.has(i))continue;
   for(let j=i+1;j<fragments.length;j++){if(used.has(j))continue;let pool=[fragments[i],fragments[j]];
    const tryPool=list=>{const P=[],C=[];for(const f of list)for(let q=0;q<f.pt.length;q++){P.push(f.pt[q]);C.push(f.cls[q]);}return leanRoundPartial(P,scale,C,leanCover);};
    let d=tryPool(pool);if(!d)continue;
    for(let k=0;k<fragments.length;k++){if(k===i||k===j||used.has(k))continue;const z=tryPool([...pool,fragments[k]]);if(z){pool.push(fragments[k]);d=z;}}
    for(const f of pool){used.add(fragments.indexOf(f));out[f.at]='';}out[fragments[i].at]=d;break;}}}
 return `<path d="${out.filter(Boolean).join(' ')}" stroke="none" fill="${color}" fill-rule="evenodd"/>`;
}

// Detail kecil berkontras tinggi (kilau mata, pupil, titik huruf) yang harus selamat dari pembuang bintik penelusur
let detailKeep=null;
function solveSmall(A,rhs){const n=A.length,M=A.map((row,i)=>[...row,...rhs.map(b=>b[i])]),tiny=1e-10*Math.abs(A[0][0]||1);
 for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(!(Math.abs(M[p][c])>tiny))return null;const row=M[c];M[c]=M[p];M[p]=row;
  for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c]/M[c][c];if(f)for(let q=c;q<n+rhs.length;q++)M[r][q]-=f*M[c][q];}}
 return rhs.map((_,j)=>M.map((row,i)=>row[n+j]/row[i]));}
// Cat per bidang. Peta label hasil palet dipecah menjadi bidang-bidang bersambung, lalu tiap bidang
// dibandingkan dengan warna sumber di bagian dalamnya (jauh dari tepi, bebas campuran antialias):
// 1) serpihan tipis di sambungan dua bidang yang warnanya campuran keduanya dilebur ke kedua bidang itu;
// 2) bidang yang warna aslinya jauh dari warna paletnya (warna kecil yang tidak kebagian tempat di palet)
//    diberi warnanya sendiri, warna serupa dikelompokkan;
// 3) bidang yang warnanya berubah perlahan diberi gradasi linear atau melingkar;
// 4) peralihan lembut yang lebar di antara dua bidang menjadi pita bergradasi (tepi lembut tetap lembut);
// 5) bentuk tipis: potongan sewarna yang berderet dijadikan satu, dan yang warna paletnya tidak
//    menjelaskan pikselnya diberi warna rata-rata pikselnya sendiri.
// label diubah di tempat menjadi indeks lapisan; medan cakupan ikut disesuaikan.
function regionPaint(label,set,rgb,W,H,scale,palette,s){
 const pal=palette.map(p=>({r:p.r,g:p.g,b:p.b})),N=W*H,n=pal.length,none=set.none,comp=new Int32Array(N),queue=new Int32Array(N),noisy=!!s.sourceNoisy,unit=scale*scale,size=s.sizeFactor||1,softLab=[];let start,lab,thin;
 const flat=k=>`rgb(${pal[k].r},${pal[k].g},${pal[k].b})`,plain=()=>({layers:pal.map((p,k)=>({field:fieldFor(set,k),color:flat(k)})),defs:'',fit:0,gradients:0});
 if(n>4000)return plain();
 // Gradasi berprofil: warna sebagai fungsi posisi sepanjang satu arah, bentuknya bebas (terang-gelap-terang pada
 // emas mengilap). Dua belas arah dicoba; tiap arah dibagi dua belas ruas dan warna rata-rata tiap ruas dicatat.
 const ANG=12,BINS=12,profAcc=new Float64Array(ANG*BINS*4),profLo=new Float64Array(ANG),profHi=new Float64Array(ANG),dirs=Array.from({length:ANG},(_,a)=>[Math.cos(a*Math.PI/ANG),Math.sin(a*Math.PI/ANG)]);
 const profile=each=>{profLo.fill(Infinity);profHi.fill(-Infinity);let m=0;
  each(p=>{const x=p%W,y=(p/W)|0;m++;for(let a=0;a<ANG;a++){const t=x*dirs[a][0]+y*dirs[a][1];if(t<profLo[a])profLo[a]=t;if(t>profHi[a])profHi[a]=t;}});
  if(m<50*unit)return null;profAcc.fill(0);let sq=0;
  each(p=>{const x=p%W,y=(p/W)|0,i=p*3,r=rgb[i],g=rgb[i+1],b=rgb[i+2];sq+=r*r+g*g+b*b;
   for(let a=0;a<ANG;a++){const span=profHi[a]-profLo[a]||1,k=Math.min(BINS-1,((x*dirs[a][0]+y*dirs[a][1]-profLo[a])/span*BINS)|0),o=(a*BINS+k)*4;profAcc[o]++;profAcc[o+1]+=r;profAcc[o+2]+=g;profAcc[o+3]+=b;}});
  let best=0,least=Infinity;for(let a=0;a<ANG;a++){let ex=0;for(let k=0;k<BINS;k++){const o=(a*BINS+k)*4,n=profAcc[o];if(n)ex+=(profAcc[o+1]**2+profAcc[o+2]**2+profAcc[o+3]**2)/n;}if(sq-ex<least){least=sq-ex;best=a;}}
  const cols=[];for(let k=0;k<BINS;k++){const o=(best*BINS+k)*4,n=profAcc[o];cols.push(n>=Math.max(3,m*.002)?[profAcc[o+1]/n,profAcc[o+2]/n,profAcc[o+3]/n]:null);}
  // ruas kosong: disisipkan dari tetangganya
  for(let k=0;k<BINS;k++){if(cols[k])continue;let a=k-1,b=k+1;while(a>=0&&!cols[a])a--;while(b<BINS&&!cols[b])b++;if(a<0&&b>=BINS)return null;cols[k]=a<0?cols[b].slice():b>=BINS?cols[a].slice():cols[a].map((v,ch)=>v+(cols[b][ch]-v)*(k-a)/(b-a));}
  let lo=[255,255,255],hi=[0,0,0];for(const c of cols)for(let ch=0;ch<3;ch++){if(c[ch]<lo[ch])lo[ch]=c[ch];if(c[ch]>hi[ch])hi[ch]=c[ch];}
  return {rms:Math.sqrt(Math.max(0,least)/m),amp:Math.max(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]),ux:dirs[best][0],uy:dirs[best][1],lo:profLo[best],span:profHi[best]-profLo[best]||1,cols};};
 const build=()=>{comp.fill(-1);start=[];lab=[];let end=0;
  for(let seed=0;seed<N;seed++){const a=label[seed];if(a<0||comp[seed]>=0)continue;const id=lab.length;lab.push(a);start.push(end);comp[seed]=id;queue[end++]=seed;
   for(let read=start[id];read<end;read++){const p=queue[read],x=p%W;let q;
    if(x&&comp[q=p-1]<0&&label[q]===a){comp[q]=id;queue[end++]=q;}
    if(x<W-1&&comp[q=p+1]<0&&label[q]===a){comp[q]=id;queue[end++]=q;}
    if(p>=W&&comp[q=p-W]<0&&label[q]===a){comp[q]=id;queue[end++]=q;}
    if(p<N-W&&comp[q=p+W]<0&&label[q]===a){comp[q]=id;queue[end++]=q;}}}
  start.push(end);
  // bidang tipis: tidak memuat blok 3x3 piksel sumber
  thin=new Uint8Array(lab.length);const u=scale,v=scale*W,big=4000*unit*size;
  for(let c=0;c<lab.length;c++){if(start[c+1]-start[c]>big)continue;let thick=false;
   for(let q=start[c];q<start[c+1]&&!thick;q++){const p=queue[q],x=p%W,y=(p/W)|0;if(x<u||y<u||x>=W-u||y>=H-u)continue;
    thick=comp[p-u]===c&&comp[p+u]===c&&comp[p-v]===c&&comp[p+v]===c&&comp[p-u-v]===c&&comp[p+u-v]===c&&comp[p-u+v]===c&&comp[p+u+v]===c;}
   thin[c]=thick?0:1;}};

 // Rapikan akhir. Peta lapisan masih memuat ribuan serpihan 1 sampai beberapa piksel di sepanjang tepi (sisa
 // campuran antialias, undakan pita yang terpotong, lingkar penajaman). Serpihan itu membuat tepi bidang di
 // sebelahnya bergerigi dan menambah titik. Serpihan yang warnanya campuran dua tetangganya atau mirip salah
 // satunya dibagi ke tetangga: tiap piksel ikut tetangga yang warnanya paling dekat. Bintik yang kontras di
 // dalam satu bidang (biji, kilau) dan potongan garis kontras dibiarkan.
 // Kotak "longgar" dari perbaikan otomatis: di dalam kotak ini detail tidak dibuang dan tidak dilebur (koordinat gambar asli).
 const relax=(s.relax||[]).map(b=>[b[0]*scale,b[1]*scale,(b[2]+1)*scale,(b[3]+1)*scale]);
 const inRelax=c=>{if(!relax.length)return false;for(let q=start[c];q<start[c+1];q++){const p=queue[q],x=p%W,y=(p/W)|0;for(const b of relax)if(x>=b[0]&&x<b[2]&&y>=b[1]&&y<b[3])return true;}return false;};
 const tidy=()=>{
  if(s.tidy===false)return;
  const acc=new Map(),S1=40*unit*size,S0=4*unit*size,drop=(s.noise||0)/(noisy?4:16)*unit*size,S2=s.halo===false?0:1500*unit*size,nd=S2?new Uint8Array(N):null;
  for(let round=0;round<2;round++){
   build();const C0=lab.length,weak=new Uint8Array(C0),dpt=new Uint8Array(C0);let any=0,changed=0;
   for(let c=0;c<C0;c++){const A=start[c+1]-start[c];if(A<=S0||(thin[c]&&A<=S1)){weak[c]=1;any++;}}
   // Lingkar tepi: bidang sempit di tepi sebuah bidang yang warnanya = warna bidang itu ditambah sedikit warna di
   // seberang tepinya (tepi yang agak buram pada gambar AI). Itu bukan bentuk tersendiri; calonnya = bidang yang
   // tidak lebih lebar dari kira-kira 8 piksel sumber. Ujinya di bawah: campurannya sangat lemah (di bawah 12%) dan
   // bidang itu menempel memanjang pada tepi (seperlima kelilingnya atau lebih). Garis terang atau bayangan yang
   // hanya ujungnya menyentuh tepi (guratan pada salmon, lipatan baju) tidak memenuhi keduanya dan dibiarkan.
   if(S2){const lim=4*scale;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x,c=comp[p];nd[p]=c<0?0:(x&&comp[p-1]!==c)||(x<W-1&&comp[p+1]!==c)||(y&&comp[p-W]!==c)||(y<H-1&&comp[p+W]!==c)?1:250;}
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x;let v=nd[p];if(v<2)continue;if(x&&nd[p-1]+1<v)v=nd[p-1]+1;if(y&&nd[p-W]+1<v)v=nd[p-W]+1;nd[p]=v;}
    for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const p=y*W+x;let v=nd[p];if(v<2)continue;if(x<W-1&&nd[p+1]+1<v)v=nd[p+1]+1;if(y<H-1&&nd[p+W]+1<v)v=nd[p+W]+1;nd[p]=v;}
    for(let c=0;c<C0;c++){if(weak[c])continue;const a0=start[c],b0=start[c+1];if(b0-a0>S2)continue;let deep=0;for(let q=a0;q<b0&&deep<=lim;q++)if(nd[queue[q]]>deep)deep=nd[queue[q]];if(deep<=lim){weak[c]=2;dpt[c]=deep;any++;}}}
   if(!any)return;
   for(let c=0;c<C0;c++){if(!weak[c])continue;if(relax.length&&inRelax(c))continue;acc.clear();let total=0,r=0,g=0,b=0,lmax=-1,lmin=999;const a0=start[c],b0=start[c+1],A=b0-a0;
    for(let q=a0;q<b0;q++){const p=queue[q],x=p%W,y=(p/W)|0,i=p*3;r+=rgb[i];g+=rgb[i+1];b+=rgb[i+2];{const L=.3*rgb[i]+.59*rgb[i+1]+.11*rgb[i+2];if(L>lmax)lmax=L;if(L<lmin)lmin=L;}
     for(const step of [x?-1:0,x<W-1?1:0,y?-W:0,y<H-1?W:0]){if(!step)continue;const z=p+step,o=comp[z];if(o===c||o<0)continue;total++;if(weak[o]===1)continue;let e=acc.get(o);if(!e)acc.set(o,e=[0,0,0,0,0]);e[4]++;
      // warna tetangga diambil dua piksel sumber ke dalam bila masih bidang yang sama (bebas campuran tepi)
      let zz=z+step*2*scale;if(zz<0||zz>=N||comp[zz]!==o||((step===1||step===-1)&&((zz/W)|0)!==y))zz=z;const j=zz*3;e[0]++;e[1]+=rgb[j];e[2]+=rgb[j+1];e[3]+=rgb[j+2];}}
    if(!acc.size)continue;
    const M0=r/A,M1=g/A,M2=b/A,T=[];for(const [o,e] of acc)T.push({o,touch:e[4],c0:e[1]/e[0],c1:e[2]/e[0],c2:e[3]/e[0]});T.sort((p,q)=>q.touch-p.touch);
    let nearest=Infinity;for(const t of T){const d=Math.hypot(M0-t.c0,M1-t.c1,M2-t.c2);if(d<nearest)nearest=d;}
    const one=T[0].touch>=.85*total;let mix=false;
    for(let i=0;i<T.length&&!mix;i++){if(T[i].touch<.15*total)break;for(let j=i+1;j<T.length;j++){if(T[j].touch<.15*total)break;const P=T[i],Q=T[j],v0=Q.c0-P.c0,v1=Q.c1-P.c1,v2=Q.c2-P.c2,u0=M0-P.c0,u1=M1-P.c1,u2=M2-P.c2,gap=v0*v0+v1*v1+v2*v2;if(gap<100)continue;
      const t=(u0*v0+u1*v1+u2*v2)/gap;if(t>.05&&t<.95&&(u0-t*v0)**2+(u1-t*v1)**2+(u2-t*v2)**2<900){mix=true;break;}}}
    if(weak[c]===2){
     // induk = tetangga yang paling mirip dan memegang sebagian besar tepinya; pasangan = tetangga lain yang kontras
     let P=null;for(const t of T){const d=Math.hypot(M0-t.c0,M1-t.c1,M2-t.c2);if(d===nearest)P=t;}
     let halo=false;if(P&&nearest<45&&P.touch>=.3*total)for(const Q of T){if(Q===P||Q.touch<(s.haloTouch??.22)*total)continue;const v0=Q.c0-P.c0,v1=Q.c1-P.c1,v2=Q.c2-P.c2,u0=M0-P.c0,u1=M1-P.c1,u2=M2-P.c2,gap=v0*v0+v1*v1+v2*v2;if(gap<3600)continue;
       const t=(u0*v0+u1*v1+u2*v2)/gap,res=(u0-t*v0)**2+(u1-t*v1)**2+(u2-t*v2)**2;
       // lingkar lewat-batas (overshoot): pita lebih terang/gelap dari induknya, ke arah menjauhi tepi kontras (penajaman, JPEG)
       if((t>.02&&t<(s.haloMix??.12)&&res<144)||(s.haloOver!==false&&t<=.02&&t>-(s.haloOver??.15)&&res<(s.haloOverRes??625)&&u0*u0+u1*u1+u2*u2<=(s.haloOverMax??32)**2&&Q.touch>=.3*total&&dpt[c]<=(s.haloOverDeep??4)*scale)){halo=true;if(self.__halo)self.__halo.push([queue[a0]%W,(queue[a0]/W)|0,A,+(Q.touch/total).toFixed(2),+t.toFixed(2)]);break;}}
     if(!halo)continue;
    }
    // serpihan di bawah ukuran yang memang dibuang saat ditelusuri: selalu dibagi, supaya tidak meninggalkan lubang
    // titik ekstrem setempat (kilau putih tipis di sklera, titik tergelap): sebagian pikselnya lebih terang/gelap
    // daripada semua tetangganya, jadi bukan campuran tepi. Tidak dibuang bila cukup menonjol.
    else if(s.keepDetail!==false&&(s.noise??16)<=(s.keepUpTo??16)&&A>=(s.keepMin??1.5)*unit&&T.some(t=>t.touch>=.15*total)&&(()=>{let hi=-1,lo=999;for(const t of T){if(t.touch<.1*total)continue;const L=.3*t.c0+.59*t.c1+.11*t.c2;if(L>hi)hi=L;if(L<lo)lo=L;}return lmax>hi+(s.extremeL??30)||lmin<lo-(s.extremeL??30);})())continue;
    else{if(s.keepDetail!==false&&(s.noise??16)<=(s.keepUpTo??16)&&A<drop&&!mix&&nearest>=(s.keepContrast??80)&&A>=(s.keepMin??1.5)*unit)continue;if(!(A<drop||mix||nearest<30||(nearest<60&&!one)))continue;}
    for(let q=a0;q<b0;q++){const p=queue[q],i=p*3;let best=Infinity,k=-1,next=Infinity,k2=-1;
     for(let j=0;j<T.length;j++){const t=T[j],e=(rgb[i]-t.c0)**2+(rgb[i+1]-t.c1)**2+(rgb[i+2]-t.c2)**2;if(e<best){next=best;k2=k;best=e;k=j;}else if(e<next){next=e;k2=j;}}
     const L=lab[T[k].o];label[p]=L;set.owner[p]=L;const L2=k2>=0?lab[T[k2].o]:L;
     if(L2!==L){const P=T[k],Q=T[k2],gap=(P.c0-Q.c0)**2+(P.c1-Q.c1)**2+(P.c2-Q.c2)**2;set.runner[p]=L2;set.t[p]=gap?Math.min(1,.5+(next-best)/(2*gap)):1;}else{set.runner[p]=none;set.t[p]=1;}}
    changed++;}
   if(!changed)break;}
 };
 // Penjaga detail: bidang kecil yang warnanya jauh dari semua tetangganya (kilau di pupil, pupil, titik, ujung
 // kecil berkontras) ditandai supaya pembuang bintik penelusur tidak membuangnya. Bintik derau berkontras rendah
 // tetap dibuang seperti biasa.
 const guard=()=>{
  detailKeep=null;if(s.keepDetail===false||(s.noise??16)>(s.keepUpTo??16))return; // pengguna menaikkan Buang detail kecil: bintik kontras ikut dibuang
  build();const C0=lab.length,Amax=(relax.length?Math.max(s.keepMax??60,400):(s.keepMax??60))*unit*size,Amin=(s.keepMin??1.5)*unit,K=(s.keepContrast??80)**2;let keep=null,n=0;
  for(let c=0;c<C0;c++){const a0=start[c],b0=start[c+1],A=b0-a0;if(A>Amax||A<Amin)continue;
   let r=0,g=0,b=0;for(let q=a0;q<b0;q++){const i=queue[q]*3;r+=rgb[i];g+=rgb[i+1];b+=rgb[i+2];}r/=A;g/=A;b/=A;
   const nb=new Map();let total=0;for(let q=a0;q<b0;q++){const p=queue[q],x=p%W,y=(p/W)|0;for(const st of [x?-1:0,x<W-1?1:0,y?-W:0,y<H-1?W:0]){if(!st)continue;const z=p+st,o=comp[z];if(o===c||o<0)continue;total++;
     // warna tetangga diambil sedikit ke dalam tetangga (bebas campuran tepi)
     let zz=z+st*scale;if(zz<0||zz>=N||comp[zz]!==o||((st===1||st===-1)&&((zz/W)|0)!==y))zz=z;let e=nb.get(o);if(!e)nb.set(o,e=[0,0,0,0]);e[0]++;e[1]+=rgb[zz*3];e[2]+=rgb[zz*3+1];e[3]+=rgb[zz*3+2];}}
   if(!total)continue;let near=Infinity;for(const e of nb.values()){if(e[0]<.15*total)continue;const d=(r-e[1]/e[0])**2+(g-e[2]/e[0])**2+(b-e[3]/e[0])**2;if(d<near)near=d;}
   if(near<K&&!(relax.length&&inRelax(c)))continue;if(!keep)keep=new Uint8Array(N);for(let q=a0;q<b0;q++)keep[queue[q]]=1;n++;}
  if(keep)detailKeep={w:W,h:H,data:keep,n};
 };
 // Kilau sebagai goresan. Kilau/bayangan tipis memanjang di dalam satu bidang induk (garis kilap pada tali, pita terang)
 // pada gambar AI tepinya bergerigi dan lebarnya naik-turun, kadang terpotong menjadi beberapa serpihan. Di sini tiap
 // serpihan dibaca sebagai goresan: tulang tengahnya (jalur terpanjang di dalam serpihan) dan lebarnya di tiap titik.
 // Serpihan yang searah dan ujungnya berdekatan dirangkai. Tulang dihaluskan, lebar dihaluskan dan meruncing di ujung,
 // lalu goresan digambar ulang. Hasilnya bentuk kilau yang mulus melengkung seperti digambar dengan kuas.
 // Hanya piksel bidang induk dan serpihan itu sendiri yang diubah; bila goresan baru terlalu berbeda dari aslinya
 // (bercabang, gemuk), serpihan dibiarkan.
 const bridge=()=>{
  if(s.bridge===false)return;
  build();const C0=lab.length,Smax=4000*unit*size,gapMax=(s.bridgeGap??14)*scale,cosA=Math.cos((s.bridgeAngle??30)*Math.PI/180),maxW=(s.strokeMaxW??4.5)*scale;
  const cm=new Float64Array(C0*3);for(let c=0;c<C0;c++){let r=0,g=0,b=0;const a0=start[c],b0=start[c+1];for(let q=a0;q<b0;q++){const i=queue[q]*3;r+=rgb[i];g+=rgb[i+1];b+=rgb[i+2];}const A=b0-a0||1;cm[c*3]=r/A;cm[c*3+1]=g/A;cm[c*3+2]=b/A;}
  const dist=new Int32Array(N).fill(-1),par=new Int32Array(N),ed=new Float32Array(N);
  // jarak ke tepi bidang sendiri (chamfer 3-4, satuan piksel)
  for(let p=0;p<N;p++){const c=comp[p],x=p%W,y=(p/W)|0;ed[p]=c<0?0:(x&&comp[p-1]!==c)||(x<W-1&&comp[p+1]!==c)||(y&&comp[p-W]!==c)||(y<H-1&&comp[p+W]!==c)?1:1e4;}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x;let v=ed[p];if(v<=1)continue;if(x&&ed[p-1]+1<v)v=ed[p-1]+1;if(y&&ed[p-W]+1<v)v=ed[p-W]+1;if(x&&y&&ed[p-W-1]+1.414<v)v=ed[p-W-1]+1.414;if(x<W-1&&y&&ed[p-W+1]+1.414<v)v=ed[p-W+1]+1.414;ed[p]=v;}
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const p=y*W+x;let v=ed[p];if(v<=1)continue;if(x<W-1&&ed[p+1]+1<v)v=ed[p+1]+1;if(y<H-1&&ed[p+W]+1<v)v=ed[p+W]+1;if(x<W-1&&y<H-1&&ed[p+W+1]+1.414<v)v=ed[p+W+1]+1.414;if(x&&y<H-1&&ed[p+W-1]+1.414<v)v=ed[p+W-1]+1.414;ed[p]=v;}
  const bfs=(c,from)=>{const a0=start[c],b0=start[c+1];for(let q=a0;q<b0;q++)dist[queue[q]]=-1;const Q=[from];dist[from]=0;par[from]=-1;let far=from;
   for(let h=0;h<Q.length;h++){const p=Q[h],x=p%W;if(dist[p]>dist[far])far=p;for(const st of [-1,1,-W,W,-W-1,-W+1,W-1,W+1]){const z=p+st;if(z<0||z>=N||comp[z]!==c||dist[z]>=0)continue;const zx=z%W;if(Math.abs(zx-x)>1)continue;dist[z]=dist[p]+1;par[z]=p;Q.push(z);}}return far;};
  const F=[];
  for(let c=0;c<C0;c++){const a0=start[c],b0=start[c+1],A=b0-a0;if(A>Smax||A<3*unit)continue;
   let mw=0;for(let q=a0;q<b0;q++)if(ed[queue[q]]>mw)mw=ed[queue[q]];if(2*mw-1>maxW+1)continue;
   const touch=new Map();let total=0;for(let q=a0;q<b0;q++){const p=queue[q],x=p%W,y=(p/W)|0;for(const st of [x?-1:0,x<W-1?1:0,y?-W:0,y<H-1?W:0]){if(!st)continue;const o=comp[p+st];if(o===c||o<0)continue;total++;touch.set(o,(touch.get(o)||0)+1);}}
   let P=-1,near=Infinity;for(const [o,k] of touch){if(k<.2*total)continue;const d=(cm[c*3]-cm[o*3])**2+(cm[c*3+1]-cm[o*3+1])**2+(cm[c*3+2]-cm[o*3+2])**2;if(d<near){near=d;P=o;}}
   if(P<0||near>130*130||near<12*12||start[P+1]-start[P]<2*A)continue;
   // tulang: jalur terpanjang (dua kali BFS)
   const e1=bfs(c,queue[a0]),e2=bfs(c,e1);const bone=[];for(let p=e2;p>=0;p=par[p])bone.push(p);
   const len=bone.length,wid=A/len;
   if(len<3*Math.max(1,wid)||len<4*scale)continue;
   // pusatkan tulang: tiap piksel serpihan ikut titik tulang terdekat; titik = rata-rata pikselnya, lebar = jumlah
   // piksel per panjang langkah (jalur terpendek cenderung menempel ke sisi dalam lengkungan)
   const bx=bone.map(p=>p%W),by=bone.map(p=>(p/W)|0),cnt=new Float64Array(len),sxx=new Float64Array(len),syy=new Float64Array(len);
   for(let q=a0;q<b0;q++){const p=queue[q],x=p%W,y=(p/W)|0;let best=Infinity,k=0;for(let i=0;i<len;i++){const d=(x-bx[i])**2+(y-by[i])**2;if(d<best){best=d;k=i;}}cnt[k]++;sxx[k]+=x;syy[k]+=y;}
   const pts=[];for(let i=0;i<len;i++){const st=i===0||i===len-1?1:Math.hypot(bx[i+1]-bx[i-1],by[i+1]-by[i-1])/2||1;pts.push(cnt[i]?[sxx[i]/cnt[i],syy[i]/cnt[i],Math.max(1,cnt[i]/st)]:[bx[i],by[i],1]);}
   const tan=(k,dir)=>{const a=pts[k],b=pts[Math.max(0,Math.min(len-1,k+dir*Math.min(6*scale,len-1)))];const dx=a[0]-b[0],dy=a[1]-b[1],l=Math.hypot(dx,dy)||1;return [dx/l,dy/l];};
   F.push({c,P,A,pts,e:[[pts[0],tan(0,1)],[pts[len-1],tan(len-1,-1)]],i:F.length});}
  // rangkai: ujung ke ujung, arah keluar ujung yang satu sejalan dengan arah masuk ujung lain
  const link=F.map(()=>[null,null]);
  const cand=[];for(let i=0;i<F.length;i++)for(let j=i+1;j<F.length;j++){const a=F[i],b=F[j];if(a.P!==b.P)continue;
   if((cm[a.c*3]-cm[b.c*3])**2+(cm[a.c*3+1]-cm[b.c*3+1])**2+(cm[a.c*3+2]-cm[b.c*3+2])**2>45*45)continue;
   for(let u=0;u<2;u++)for(let v=0;v<2;v++){const [pa,ta]=a.e[u],[pb,tb]=b.e[v],dx=pb[0]-pa[0],dy=pb[1]-pa[1],d=Math.hypot(dx,dy);if(d>gapMax)continue;
    const ok=d<1.5||((dx*ta[0]+dy*ta[1])/d>=cosA&&(-dx*tb[0]-dy*tb[1])/d>=cosA);if(!ok)continue;
    if(d>=1.5){let clear=true;for(let k=1;k<d&&clear;k++){const o=comp[Math.round(pa[1]+dy*k/d)*W+Math.round(pa[0]+dx*k/d)];if(o!==a.P&&o!==a.c&&o!==b.c)clear=false;}if(!clear)continue;}
    cand.push([d,i,u,j,v]);}}
  cand.sort((p,q)=>p[0]-q[0]);for(const [d,i,u,j,v] of cand){if(link[i][u]||link[j][v])continue;
   // cegah lingkaran
   let k=j,side=1-v,loop=false,guard=0;while(k!==null&&guard++<1e4){if(k===i){loop=true;break;}const nx=link[k][side];if(!nx)break;k=nx[0];side=1-nx[1];}if(loop)continue;
   link[i][u]=[j,v];link[j][v]=[i,u];}
  const used=new Uint8Array(F.length);let painted=0,tried=0;
  for(let s0=0;s0<F.length;s0++){if(used[s0])continue;
   // mulai dari ujung rangkaian
   let k=s0,side=0,guard=0;while(link[k][side]&&guard++<1e4){const [nk,nv]=link[k][side];k=nk;side=1-nv;if(k===s0)break;}
   const chain=[];let cur=k,entry=side;guard=0;while(cur!==null&&!used[cur]&&guard++<1e4){used[cur]=1;const f=F[cur],seq=entry===0?f.pts:f.pts.slice().reverse();chain.push({f,seq});const nx=link[cur][1-entry];if(!nx)break;cur=nx[0];entry=nx[1];}
   const host=chain[0].f.P;
   // titik tulang berurutan, celah disisipi garis lurus
   let P=[];for(const {seq} of chain){if(P.length){const a=P[P.length-1],b=seq[0],d=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let t=1;t<d;t++)P.push([a[0]+(b[0]-a[0])*t/d,a[1]+(b[1]-a[1])*t/d,Math.min(a[2],b[2])]);}for(const p of seq)P.push(p);}
   if(P.length<5)continue;tried++;
   // haluskan tulang dan lebar (Gauss sepanjang tulang, ujung dipantulkan)
   const sm=(arr,sg,idx)=>{const R=Math.ceil(2.5*sg),n=arr.length,out=new Float64Array(n);for(let i=0;i<n;i++){let a=0,w=0;for(let d=-R;d<=R;d++){let j=i+d;if(j<0)j=-j;if(j>=n)j=2*n-2-j;j=Math.max(0,Math.min(n-1,j));const g=Math.exp(-d*d/(2*sg*sg));a+=g*arr[j][idx];w+=g;}out[i]=a/w;}return out;};
   const sgB=Math.max(1.5,2*scale),X=sm(P,sgB,0),Y=sm(P,sgB,1),Wd=sm(P,Math.max(2,4*scale),2),n=P.length;
   // ujung tetap di tempatnya
   X[0]=P[0][0];Y[0]=P[0][1];X[n-1]=P[n-1][0];Y[n-1]=P[n-1][1];
   const tp=Math.min(n/2,Math.max(3,.18*n));const half=new Float64Array(n);for(let i=0;i<n;i++){const e=Math.min(i,n-1-i);half[i]=Math.max(.5,Wd[i]/2*Math.min(1,.45+.55*e/tp));}
   const mine=new Set(chain.map(c=>c.f.c));let x0=W,x1=0,y0=H,y1=0;for(let i=0;i<n;i++){x0=Math.min(x0,X[i]-half[i]-1);x1=Math.max(x1,X[i]+half[i]+1);y0=Math.min(y0,Y[i]-half[i]-1);y1=Math.max(y1,Y[i]+half[i]+1);}
   for(const {f} of chain)for(let q=start[f.c];q<start[f.c+1];q++){const p=queue[q],x=p%W,y=(p/W)|0;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
   x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(W-1,Math.ceil(x1));y1=Math.min(H-1,Math.ceil(y1));
   const inside=(x,y)=>{for(let i=0;i<n-1;i++){const ax=X[i],ay=Y[i],bx=X[i+1],by=Y[i+1],vx=bx-ax,vy=by-ay,l2=vx*vx+vy*vy||1;let t=((x-ax)*vx+(y-ay)*vy)/l2;t=t<0?0:t>1?1:t;const d=Math.hypot(x-ax-vx*t,y-ay-vy*t),h=half[i]+(half[i+1]-half[i])*t;if(d<=h)return true;}return false;};
   // pemeriksaan: goresan baru harus menutup sebagian besar piksel serpihan dan tidak menggemuk
   // induk harus jauh lebih lebar dari goresan (kilau di atas tali, bukan sliver di samping batang yang sama tipisnya)
   let hostDeep=0,hmax=0;for(let i=0;i<n;i++)if(half[i]>hmax)hmax=half[i];
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const p=y*W+x;if(comp[p]===host&&ed[p]>hostDeep)hostDeep=ed[p];}
   if(hostDeep<2*hmax+1.5*scale)continue;
   let orig=0,cover=0,added=0;const plan=[];
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const p=y*W+x,o=comp[p];if(o!==host&&!mine.has(o))continue;const inn=inside(x+.0,y+.0),was=mine.has(o);if(was){orig++;if(inn)cover++;}else if(inn)added++;plan.push([p,inn]);}
   const gapPx=n-chain.reduce((a,c)=>a+c.seq.length,0);
   if(self.__rej)self.__rej.push([Math.round(X[0]),Math.round(Y[0]),Math.round(X[n-1]),Math.round(Y[n-1]),chain.length,n,orig,cover,added,gapPx]);
   if(cover<(s.strokeCover??.7)*orig||added>.45*orig+gapPx*2*Math.max(1,half[(n/2)|0]))continue;
   const L=lab[chain.reduce((a,c)=>c.f.A>a.f.A?c:a).f.c],hostL=lab[host];
   for(const [p,inn] of plan){const want=inn?L:hostL;if(label[p]!==want){label[p]=want;set.owner[p]=want;set.runner[p]=inn?hostL:L;set.t[p]=1;painted++;}}
   if(self.__br)self.__br.push([Math.round(X[0]),Math.round(Y[0]),Math.round(X[n-1]),Math.round(Y[n-1]),chain.length,n,+(2*half[(n/2)|0]).toFixed(1)]);}
  if(self.__br)self.__br.push(['dicoba',tried,'kandidat',F.length]);
  if(painted)build();
 };
 build();if(self.__dbg)self.__dbg('0-awal',label,W,H,pal);
 // 1b) bidang bersebelahan yang nyaris sewarna dan tidak dipisahkan tepi yang nyata (garis hitam yang
 //     sebagian terbaca biru tua, bercak pada bayangan lembut) dijadikan satu: yang kecil ikut yang besar.
 //     Potongan-potongan tipis yang berderet (garis terang tipis yang terbaca putih, krem, putih, ...)
 //     boleh disatukan berantai dan dengan beda warna lebih longgar: warna terukur bentuk tipis memang
 //     campuran dengan sekelilingnya.
 const unify=thinOnly=>{
  const C0=lab.length,tone=pal.map(perceptualLab),parent=Int32Array.from({length:C0},(_,c)=>c),host=new Uint8Array(C0),child=new Uint8Array(C0),area=c=>start[c+1]-start[c];let changed=false;
  const find=c=>{while(parent[c]!==c){parent[c]=parent[parent[c]];c=parent[c];}return c;},dE=(a,b)=>Math.hypot(tone[a][0]-tone[b][0],tone[a][1]-tone[b][1],tone[a][2]-tone[b][2]);
  // dari yang terkecil; bidang biasa yang sudah menampung bidang lain tidak ikut dilebur lagi (tanpa rantai:
  // warna tidak boleh bergeser selangkah demi selangkah melintasi gradasi lebar)
  for(const c of Array.from({length:C0},(_,c)=>c).sort((x,y)=>area(x)-area(y))){const a=lab[c],A=pal[a],reach=thin[c]?.15:.075;if(thinOnly?!thin[c]:host[c]&&!thin[c])continue;
   let any=false;for(let k=0;k<n&&!any;k++)any=k!==a&&dE(a,k)<reach;if(!any)continue;
   const seen=new Map();
   for(let q=start[c];q<start[c+1];q++){const p=queue[q],x=p%W,y=(p/W)|0;
    for(const step of [x?-1:0,x<W-1?1:0,y?-W:0,y<H-1?W:0]){if(!step)continue;const z=p+step,o=comp[z];if(o===c||o<0)continue;let e=seen.get(o);if(!e)seen.set(o,e={edges:0,crisp:0});
     const i=p-step*scale,j=z+step*scale,inside=i>=0&&i<N&&j>=0&&j<N&&(Math.abs(step)>1||(((i/W)|0)===y&&((j/W)|0)===y));
     // selisih warna melintasi batas: sepasang piksel bersebelahan, atau sepasang yang berjarak tiga piksel bila itu lebih kecil
     const near=Math.hypot(rgb[p*3]-rgb[z*3],rgb[p*3+1]-rgb[z*3+1],rgb[p*3+2]-rgb[z*3+2]),far=inside?Math.hypot(rgb[i*3]-rgb[j*3],rgb[i*3+1]-rgb[j*3+1],rgb[i*3+2]-rgb[j*3+2]):1e3;
     e.edges++;e.crisp+=Math.min(near,far);}}
   let best=-1,most=1;for(const [o,e] of seen){const b=lab[o],B=pal[b],soft=e.crisp/e.edges<.42*(Math.hypot(A.r-B.r,A.g-B.g,A.b-B.b)||1);if(b===a||!soft)continue;
    if(thin[c]&&thin[o]&&s.thinChains!==false&&dE(a,b)<.15){if(find(c)!==find(o)){parent[find(c)]=find(o);changed=true;}continue;}
    if(thinOnly||host[c]||child[c]||area(o)<2*area(c)||child[o]||dE(a,b)>=.075)continue;if(e.edges>most){most=e.edges;best=o;}}
   if(best>=0&&find(c)!==find(best)){parent[find(c)]=find(best);child[c]=1;host[best]=1;changed=true;}}
  if(changed){const lead=new Int32Array(C0).fill(-1);for(let c=0;c<C0;c++){const r=find(c);if(lead[r]<0||area(c)>area(lead[r]))lead[r]=c;}
   for(let c=0;c<C0;c++){const L=lab[lead[find(c)]];if(L===lab[c])continue;for(let q=start[c];q<start[c+1];q++){const p=queue[q];label[p]=L;set.owner[p]=L;}}build();}
  };
 // rantai bentuk tipis disatukan dulu, supaya garis tipis utuh tidak ikut dilebur sebagai serpihan
 if(s.unify!==false&&s.thinChains!==false)unify(true);if(self.__dbg)self.__dbg('1-rantai',label,W,H,pal);
 // 1) serpihan campuran
 if(s.specks!==false){
  const limit=40*(s.sizeFactor||1)*unit,tol=(noisy?30:20)**2,touch=new Float64Array(n);let changed=false;
  for(let c=0;c<lab.length;c++){const a0=start[c],b0=start[c+1],area=b0-a0;if(area>limit)continue;
   if(!thin[c])continue;touch.fill(0);let total=0,r=0,g=0,b=0;
   // warna di sekitar serpihan: semua label dalam jarak dua piksel sumber (garis tipis di dekatnya ikut terhitung)
   const R=2*scale;
   for(let q=a0;q<b0;q++){const p=queue[q],x=p%W,y=(p/W)|0,i=p*3;r+=rgb[i];g+=rgb[i+1];b+=rgb[i+2];
    for(let dy=-R;dy<=R;dy++){const yy=y+dy;if(yy<0||yy>=H)continue;for(let dx=-R;dx<=R;dx++){const xx=x+dx;if(xx<0||xx>=W)continue;const z=yy*W+xx;if(comp[z]===c)continue;total++;if(label[z]>=0)touch[label[z]]++;}}}
   if(!total)continue;
   const near=[];for(let k=0;k<n;k++)if(touch[k]>=Math.max(1,total*.04))near.push(k);near.sort((x,y)=>touch[y]-touch[x]);near.length=Math.min(near.length,5);if(!near.length)continue;
   // serpihan itu campuran dua warna di sekitarnya? pasangan yang paling cocok dipakai
   const M=[r/area,g/area,b/area];let A=-1,B=-1,least=tol;
   if(near.length===1||touch[near[0]]>=total*.9){const P=pal[near[0]],e=(M[0]-P.r)**2+(M[1]-P.g)**2+(M[2]-P.b)**2;if(e<least){least=e;A=B=near[0];}}
   for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++){const PA=pal[near[i]],PB=pal[near[j]],v=[PB.r-PA.r,PB.g-PA.g,PB.b-PA.b],u=[M[0]-PA.r,M[1]-PA.g,M[2]-PA.b],gap=v[0]*v[0]+v[1]*v[1]+v[2]*v[2];if(!gap)continue;
    const t=(u[0]*v[0]+u[1]*v[1]+u[2]*v[2])/gap,e=(u[0]-t*v[0])**2+(u[1]-t*v[1])**2+(u[2]-t*v[2])**2;if(t>-.05&&t<1.05&&e<least){least=e;A=near[i];B=near[j];}}
   if(A<0)continue;const PA=pal[A],PB=pal[B],gap=(PA.r-PB.r)**2+(PA.g-PB.g)**2+(PA.b-PB.b)**2;
   for(let q=a0;q<b0;q++){const p=queue[q],i=p*3,eA=(rgb[i]-PA.r)**2+(rgb[i+1]-PA.g)**2+(rgb[i+2]-PA.b)**2,eB=(rgb[i]-PB.r)**2+(rgb[i+1]-PB.g)**2+(rgb[i+2]-PB.b)**2,own=eA<=eB?A:B;
    label[p]=own;set.owner[p]=own;if(!gap){set.runner[p]=none;set.t[p]=1;}else{set.runner[p]=own===A?B:A;set.t[p]=Math.min(1,.5+Math.abs(eA-eB)/(2*gap));}}
   changed=true;}
  if(changed)build();
 }
 if(self.__dbg)self.__dbg('2-serpih',label,W,H,pal);
 if(s.unify!==false)unify(false);
 // 1c) Pecahan gradasi. Gradasi halus terbelah menjadi beberapa bidang karena dua warna palet sama-sama dekat;
 //     batasnya bergerigi mengikuti derau, bukan mengikuti tepi. Dua bidang bersebelahan dijadikan satu bila
 //     (a) hampir seluruh batasnya tanpa tepi: warna 1, 3, dan 5 piksel sumber melintasi batas nyaris sama, dan
 //     (b) gabungannya tetap dijelaskan oleh satu bidang warna miring (galat kecil), jadi satu gradasi cukup.
 //     Dikerjakan bertahap; batas antar-kelompok dihitung ulang tiap tahap, sehingga tepi nyata di antara dua
 //     anggota kelompok tetap mencegah peleburan.
 const fuse=()=>{
  const C0=lab.length;if(C0<2||C0>60000)return;
  const T=noisy?12:10,MM=18,inner=new Float64Array(C0*MM),whole=new Float64Array(C0*MM),SZ=Math.max(W,H),u=scale,v=scale*W;
  const add=(arr,c,p)=>{const X=(p%W-W/2)/SZ,Y=(((p/W)|0)-H/2)/SZ,o=c*MM,i=p*3;arr[o]++;arr[o+1]+=X;arr[o+2]+=Y;arr[o+3]+=X*X;arr[o+4]+=X*Y;arr[o+5]+=Y*Y;
   for(let ch=0;ch<3;ch++){const val=rgb[i+ch],z=o+6+ch*4;arr[z]+=val;arr[z+1]+=val*X;arr[z+2]+=val*Y;arr[z+3]+=val*val;}};
  const perim=new Uint32Array(C0),pairs=new Map(),dist=(a,b)=>{a*=3;b*=3;return Math.hypot(rgb[a]-rgb[b],rgb[a+1]-rgb[b+1],rgb[a+2]-rgb[b+2]);};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x,c=comp[p];if(c<0)continue;add(whole,c,p);
   if(x>=2*u&&y>=2*u&&x<W-2*u&&y<H-2*u&&comp[p-u]===c&&comp[p+u]===c&&comp[p-v]===c&&comp[p+v]===c&&comp[p-2*u]===c&&comp[p+2*u]===c&&comp[p-2*v]===c&&comp[p+2*v]===c)add(inner,c,p);
   for(let dir=0;dir<2;dir++){const step=dir?W:1;if(dir?y>=H-1:x>=W-1)continue;const z=p+step,o=comp[z];if(o<0||o===c)continue;
    // hanya batas yang kedua sisinya (sampai 2 px sumber) masih di dalam kedua bidang itu yang dinilai;
    // di dekat garis luar bentuk, sampel jauh sudah mengenai warna lain dan tidak berkata apa-apa
    const close=dist(p,z);let contrast=close,valid=true;const lim=dir?Math.min(y,H-2-y):Math.min(x,W-2-x);
    for(let k=1;k<=2&&valid;k++){const far=k*u;if(far>lim){valid=false;break;}const i=p-step*far,j=z+step*far,ci=comp[i],cj=comp[j];if((ci!==c&&ci!==o)||(cj!==c&&cj!==o)){valid=false;break;}const e=dist(i,j);if(e>contrast)contrast=e;}
    const key=c<o?c*C0+o:o*C0+c;let e=pairs.get(key);if(!e){const A=pal[lab[c]],B=pal[lab[o]];const D=Math.hypot(A.r-B.r,A.g-B.g,A.b-B.b);pairs.set(key,e={a:Math.min(c,o),b:Math.max(c,o),all:0,gentle:0,mild:0,D,edges:0,soft:0,sum:0,limit:Math.max(T,.4*D)});}e.all++;perim[c]++;perim[o]++;if(close<e.limit)e.gentle++;if(close<.5*e.D+2)e.mild++;if(valid){e.edges++;e.sum+=contrast;if(contrast<e.limit)e.soft++;}}}
  // momen yang dipakai: bagian dalam bila cukup, selain itu seluruh piksel (pecahan kecil di garis batas)
  const mom=new Float64Array(C0*MM);for(let c=0;c<C0;c++){const src=inner[c*MM]>=12*unit?inner:whole;for(let k=0;k<MM;k++)mom[c*MM+k]=src[c*MM+k];}
  const rms=(arr,o)=>{const m=arr[o];if(m<3)return 0;const mx=arr[o+1]/m,my=arr[o+2]/m,cxx=arr[o+3]-m*mx*mx,cxy=arr[o+4]-m*mx*my,cyy=arr[o+5]-m*my*my,det=cxx*cyy-cxy*cxy;let res=0;
   for(let ch=0;ch<3;ch++){const z=o+6+ch*4,sv=arr[z],cvx=arr[z+1]-mx*sv,cvy=arr[z+2]-my*sv,cvv=arr[z+3]-sv*sv/m;let ex=0;
    if(det>1e-9*cxx*cyy&&cxx>0&&cyy>0){const gx=(cvx*cyy-cvy*cxy)/det,gy=(cvy*cxx-cvx*cxy)/det;ex=gx*cvx+gy*cvy;}else if(cxx+cyy>0){const cv=cxx>=cyy?cvx:cvy,cc=cxx>=cyy?cxx:cyy;ex=cv*cv/cc;}
    res+=Math.max(0,cvv-ex);}
   return Math.sqrt(res/m);};
  const parent=Int32Array.from({length:C0},(_,c)=>c),find=c=>{while(parent[c]!==c){parent[c]=parent[parent[c]];c=parent[c];}return c;},sum=new Float64Array(MM),base=noisy?7:5,members=Array.from({length:C0},(_,c)=>[c]),fitted=new Float64Array(C0).fill(-1);let merged=0,budget=30*N;
  const list=[...pairs.values()];
  for(let round=0;round<12;round++){
   const groups=new Map();for(const e of list){const a=find(e.a),b=find(e.b);if(a===b)continue;const key=a<b?a*C0+b:b*C0+a;let g=groups.get(key);if(!g)groups.set(key,g={a:Math.min(a,b),b:Math.max(a,b),all:0,edges:0,soft:0,sum:0});g.all+=e.all;g.edges+=e.edges;g.soft+=e.soft;g.sum+=e.sum;}
   const cand=[...groups.values()].filter(g=>g.edges>=Math.max(2*scale,.3*g.all)&&g.soft>=.75*g.edges).sort((x,y)=>y.soft/y.edges-x.soft/x.edges||y.edges-x.edges),busy=new Set();let any=false;
   for(const g of cand){if(busy.has(g.a)||busy.has(g.b))continue;const oa=g.a*MM,ob=g.b*MM;for(let k=0;k<MM;k++)sum[k]=mom[oa+k]+mom[ob+k];
    const ra=fitted[g.a]>=0?fitted[g.a]:rms(mom,oa),rb=fitted[g.b]>=0?fitted[g.b]:rms(mom,ob),ru=rms(sum,0);let by=-1;
    let ok=ru<=Math.max(base,1.3*Math.max(ra,rb));
    if(!ok&&s.profile!==false&&ru<=5*base&&sum[0]>=200*unit&&budget>0){budget-=sum[0];const A=g.a,B=g.b,P=profile(cb=>{for(const list of [members[A],members[B]])for(const c of list)for(let q=start[c];q<start[c+1];q++){const p=queue[q],x=p%W,y=(p/W)|0;if(x<u||y<u||x>=W-u||y>=H-u)continue;
       let z=find(comp[p-u]);if(z!==A&&z!==B)continue;z=find(comp[p+u]);if(z!==A&&z!==B)continue;z=find(comp[p-v]);if(z!==A&&z!==B)continue;z=find(comp[p+v]);if(z!==A&&z!==B)continue;cb(p);}});
     ok=!!P&&P.rms<=Math.max(base+1,.75*Math.max(ra,rb));if(ok)by=P.rms;}
    if(!ok)continue;
    for(const c of members[g.b])members[g.a].push(c);members[g.b]=null;fitted[g.a]=by>=0?by:fitted[g.a]>=0||fitted[g.b]>=0?Math.max(fitted[g.a],fitted[g.b]):-1;
    for(let k=0;k<MM;k++)mom[oa+k]=sum[k];parent[g.b]=g.a;busy.add(g.a);busy.add(g.b);any=true;merged++;}
   if(!any)break;}
  // Serpihan tipis di sepanjang tepi (lingkar terang hasil penajaman, sisa campuran) yang nyaris sewarna dengan
  // bidang di sebelahnya dan tidak dipisahkan tepi nyata darinya: ikut bidang itu.
  {const tone=pal.map(perceptualLab),best=new Int32Array(C0).fill(-1),score=new Float64Array(C0),area=c=>start[c+1]-start[c],cap=600*unit*size;
   for(const e of list)for(const [c,o] of [[e.a,e.b],[e.b,e.a]]){if(!thin[c]||thin[o]||area(c)>cap||area(o)<4*area(c)||find(c)!==c)continue;
    if(e.all<.3*perim[c]||e.gentle<.85*e.all)continue;const A=tone[lab[c]],B=tone[lab[o]];if(Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2])>=.075)continue;if(e.all>score[c]){score[c]=e.all;best[c]=o;}}
   for(let c=0;c<C0;c++)if(best[c]>=0){parent[c]=find(best[c]);merged++;}
   // Bercak kecil pada bidang yang belang halus (tekstur gambar AI): dua warna palet yang berdekatan saling
   // menyelip. Bercak ikut tetangga sewarna-dekat yang paling panjang batasnya, bila batasnya landai atau
   // bercaknya sangat kecil dan warnanya nyaris tak terbedakan.
   const small=400*unit*size;best.fill(-1);score.fill(0);
   for(const e of list)for(const [c,o] of [[e.a,e.b],[e.b,e.a]]){if(e.D>18||thin[c]||area(c)>small||area(o)<area(c)||e.all<Math.max(6*scale,.15*perim[c])||(e.mild<.8*e.all&&(e.D>16||area(c)>small/2)))continue;if(e.all>score[c]){score[c]=e.all;best[c]=o;}}
   for(let c=0;c<C0;c++)if(best[c]>=0){const a=find(c),b=find(best[c]);if(a===b)continue;const oa=b*MM,ob=a*MM;for(let k=0;k<MM;k++)mom[oa+k]+=mom[ob+k];parent[a]=b;merged++;}}
  if(!merged)return;
  // label kelompok = label anggota terluas
  // label kelompok = warna palet anggotanya yang paling dekat dengan warna rata-rata kelompok
  const lead=new Int32Array(C0).fill(-1),far=new Float64Array(C0),area=c=>start[c+1]-start[c];
  for(let c=0;c<C0;c++){if(thin[c]&&find(c)!==c)continue;const r=find(c),o=r*MM,m=mom[o]||1,P=pal[lab[c]],e=(mom[o+6]/m-P.r)**2+(mom[o+10]/m-P.g)**2+(mom[o+14]/m-P.b)**2;if(lead[r]<0||e<far[r]-1e-9||(Math.abs(e-far[r])<=1e-9&&area(c)>area(lead[r]))){lead[r]=c;far[r]=e;}}
  for(let c=0;c<C0;c++){const r=find(c);if(lead[r]<0)lead[r]=r;}
  for(let c=0;c<C0;c++){const r=find(c),Lb=lab[lead[r]];if(lead[r]===c)continue;const old=lab[c];
   for(let q=start[c];q<start[c+1];q++){const p=queue[q];if(Lb!==old){label[p]=Lb;set.owner[p]=Lb;}if(set.runner[p]===Lb){set.runner[p]=none;set.t[p]=1;}}}
  build();
 };
 if(s.fuse!==false)fuse();
 if(self.__dbg)self.__dbg('3-lebur',label,W,H,pal);
 if(s.recolor===false&&s.gradients===false&&s.split===false){tidy();bridge();guard();return plain();}
 // kedalaman tiap piksel dari tepi bidangnya (1 = piksel tepi) dan momen bagian dalam:
 // kuat = minimal 2 px sumber dari tepi, lemah = minimal 1 px. Koordinat dinormalkan per bidang
 // (titik acuan = piksel pertamanya, satuan = akar luasnya) supaya hitungannya stabil.
 const depth=new Uint8Array(N),strong=2*scale+1,weak=scale+1,minAmp=noisy?12:10,K=24,pr=[0,0,0],scratch=new Int32Array(N);let C,S,Wk,ox,oy,L;
 const measure=other=>{C=lab.length;S=new Float64Array(C*K);Wk=new Float64Array(C*4);ox=new Float64Array(C);oy=new Float64Array(C);L=new Float64Array(C);
  for(let c=0;c<C;c++){const p=queue[start[c]];ox[c]=p%W;oy[c]=(p/W)|0;L[c]=Math.max(4,Math.sqrt(start[c+1]-start[c]));}
  // other (bila diminta): bidang lain yang terdekat dari tiap piksel, ikut dirambatkan bersama kedalaman
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x,c=comp[p];if(other)other[p]=-1;if(c<0){depth[p]=0;continue;}let o=-1,edge=false,z;
   if(x&&(z=comp[p-1])!==c){edge=true;if(z>=0)o=z;}if(x<W-1&&(z=comp[p+1])!==c){edge=true;if(z>=0)o=z;}if(y&&(z=comp[p-W])!==c){edge=true;if(z>=0)o=z;}if(y<H-1&&(z=comp[p+W])!==c){edge=true;if(z>=0)o=z;}
   depth[p]=edge?1:250;if(other&&edge)other[p]=o;}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x;let v=depth[p],from=-1;if(v<2)continue;if(x&&depth[p-1]+1<v){v=depth[p-1]+1;from=p-1;}if(y&&depth[p-W]+1<v){v=depth[p-W]+1;from=p-W;}if(from>=0){depth[p]=v;if(other)other[p]=other[from];}}
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const p=y*W+x;let v=depth[p],from=-1;if(v<2)continue;if(x<W-1&&depth[p+1]+1<v){v=depth[p+1]+1;from=p+1;}if(y<H-1&&depth[p+W]+1<v){v=depth[p+W]+1;from=p+W;}if(from>=0){depth[p]=v;if(other)other[p]=other[from];}}
  for(let p=0;p<N;p++){const dp=depth[p];if(!dp)continue;const c=comp[p],i=p*3,whole=softLab[lab[c]];if(dp<weak&&!whole)continue;
   if(dp<strong&&!whole){const o=c*4;Wk[o]++;Wk[o+1]+=rgb[i];Wk[o+2]+=rgb[i+1];Wk[o+3]+=rgb[i+2];continue;}
   const x=(p%W-ox[c])/L[c],y=(((p/W)|0)-oy[c])/L[c],q=x*x+y*y,o=c*K;S[o]++;S[o+1]+=x;S[o+2]+=y;S[o+3]+=x*x;S[o+4]+=x*y;S[o+5]+=y*y;S[o+6]+=x*q;S[o+7]+=y*q;S[o+8]+=q*q;
   for(let ch=0;ch<3;ch++){const v=rgb[i+ch],z=o+9+ch*5;S[z]+=v;S[z+1]+=v*x;S[z+2]+=v*y;S[z+3]+=v*v;S[z+4]+=v*q;}}};
 // Warna asli bidang: rata-rata bagian dalam. Bila warnanya berubah perlahan: gradasi linear (arah utama
 // perubahan warna, lalu kemiringan tiap kanal sepanjang arah itu) atau gradasi melingkar (warna sebagai
 // fungsi jarak kuadrat dari satu pusat), mana yang jelas lebih menjelaskan.
 const model=c=>{const o=c*K,m=S[o];let mean=null;
  if(m>=6*unit)mean=[S[o+9]/m,S[o+14]/m,S[o+19]/m];else if(Wk[c*4]+m>=4*unit){const z=c*4,q=Wk[z]+m;mean=[(Wk[z+1]+S[o+9])/q,(Wk[z+2]+S[o+14])/q,(Wk[z+3]+S[o+19])/q];}
  if(!mean)return null;const M={mean,ox:ox[c],oy:oy[c],L:L[c]};
  if(s.gradients===false||m<(softLab[lab[c]]?20:60)*unit)return M;
  const mx=S[o+1]/m,my=S[o+2]/m,sxx=S[o+3]-m*mx*mx,sxy=S[o+4]-m*mx*my,syy=S[o+5]-m*my*my,det=sxx*syy-sxy*sxy;
  if(!(sxx>0&&syy>0&&det>1e-6*sxx*syy))return M;
  let g00=0,g01=0,g11=0,spread=0;const bx=[0,0,0],by=[0,0,0];
  for(let ch=0;ch<3;ch++){const z=o+9+ch*5;bx[ch]=S[z+1]-mx*S[z];by[ch]=S[z+2]-my*S[z];spread+=Math.max(0,S[z+3]-S[z]*S[z]/m);const gx=(bx[ch]*syy-by[ch]*sxy)/det,gy=(by[ch]*sxx-bx[ch]*sxy)/det;g00+=gx*gx;g01+=gx*gy;g11+=gy*gy;}
  const angle=.5*Math.atan2(2*g01,g00-g11),ux=Math.cos(angle),uy=Math.sin(angle),sss=ux*ux*sxx+2*ux*uy*sxy+uy*uy*syy;if(!(sss>0))return M;
  const k=[0,1,2].map(ch=>(ux*bx[ch]+uy*by[ch])/sss),linear=(k[0]*k[0]+k[1]*k[1]+k[2]*k[2])*sss,amp=Math.max(Math.abs(k[0]),Math.abs(k[1]),Math.abs(k[2]))*2*Math.sqrt(3*sss/m);
  if(m>=200*unit){
   const Sq=S[o+3]+S[o+5],fit=solveSmall([[m,S[o+1],S[o+2],Sq],[S[o+1],S[o+3],S[o+4],S[o+6]],[S[o+2],S[o+4],S[o+5],S[o+7]],[Sq,S[o+6],S[o+7],S[o+8]]],[0,1,2].map(ch=>{const z=o+9+ch*5;return [S[z],S[z+1],S[z+2],S[z+4]];}));
   if(fit){let se=0,sbe=0,sce=0;for(const f of fit){se+=f[3]*f[3];sbe+=f[1]*f[3];sce+=f[2]*f[3];}
    if(se>0){const x0=-sbe/(2*se),y0=-sce/(2*se),c0=x0*x0+y0*y0,R2=Sq-2*x0*S[o+1]-2*y0*S[o+2]+m*c0,
      R4=S[o+8]+4*x0*x0*S[o+3]+4*y0*y0*S[o+5]+m*c0*c0-4*x0*S[o+6]-4*y0*S[o+7]+2*c0*Sq+8*x0*y0*S[o+4]-4*x0*c0*S[o+1]-4*y0*c0*S[o+2],vary=R4-R2*R2/m;
     if(vary>0){const e=[0,0,0],a=[0,0,0];let radial=0;for(let ch=0;ch<3;ch++){const z=o+9+ch*5;e[ch]=((S[z+4]-2*x0*S[z+1]-2*y0*S[z+2]+c0*S[z])-S[z]*R2/m)/vary;a[ch]=mean[ch]-e[ch]*R2/m;radial+=e[ch]*e[ch]*vary;}
      const ampR=Math.max(Math.abs(e[0]),Math.abs(e[1]),Math.abs(e[2]))*2*Math.sqrt(3*vary/m);
      if(radial>=.5*spread&&radial>linear+.1*spread&&ampR>=minAmp&&Math.hypot(x0-mx,y0-my)<6*Math.sqrt((sxx+syy)/m))return {...M,x0,y0,a,e};}}}
  }
  const lin=linear>=.5*spread&&amp>=minAmp,rest=Math.sqrt(Math.max(0,spread-(lin?linear:0))/m);
  if(s.profile!==false&&m>=200*unit&&rest>4.5){const whole=softLab[lab[c]],P=profile(cb=>{for(let q=start[c];q<start[c+1];q++){const p=queue[q];if(whole||depth[p]>=strong)cb(p);}});
   if(P&&P.rms<=.65*rest&&P.amp>=minAmp){P.cx=M.ox+M.L*mx;P.cy=M.oy+M.L*my;return {...M,prof:P};}}
  return lin?{...M,mx,my,ux,uy,k}:M;};
 const predict=(M,p)=>{const X=(p%W-M.ox)/M.L,Y=(((p/W)|0)-M.oy)/M.L;
  if(M.prof){const P=M.prof,t=Math.max(0,Math.min(BINS-1,((p%W)*P.ux+((p/W)|0)*P.uy-P.lo)/P.span*BINS-.5)),k=Math.min(BINS-2,t|0),f=t-k,A=P.cols[k],B=P.cols[k+1];pr[0]=A[0]+(B[0]-A[0])*f;pr[1]=A[1]+(B[1]-A[1])*f;pr[2]=A[2]+(B[2]-A[2])*f;}
  else if(M.e){const q=(X-M.x0)**2+(Y-M.y0)**2;pr[0]=M.a[0]+M.e[0]*q;pr[1]=M.a[1]+M.e[1]*q;pr[2]=M.a[2]+M.e[2]*q;}
  else if(M.k){const t=(X-M.mx)*M.ux+(Y-M.my)*M.uy;pr[0]=M.mean[0]+M.k[0]*t;pr[1]=M.mean[1]+M.k[1]*t;pr[2]=M.mean[2]+M.k[2]*t;}
  else{pr[0]=M.mean[0];pr[1]=M.mean[1];pr[2]=M.mean[2];}};
 const wantBands=s.softEdges!==false&&s.recolor!==false;
 measure(wantBands?scratch:null);
 // 4) Peralihan lembut. Piksel di dekat batas dua bidang yang warnanya campuran keduanya dikumpulkan;
 //    pada tepi tegas pita campuran itu hanya 2-3 piksel, pada tepi lembut jauh lebih lebar. Pita yang
 //    cukup lebar dibagi menjadi beberapa undakan menurut kadar campurannya (seperti "blend" bertahap):
 //    tiap undakan bidang tipis berwarna antara, sehingga tepi itu tampak lembut tanpa efek blur.
 let n1=n;const mark=new Uint8Array(N);
 if(wantBands){
  const other=scratch,mods=new Array(C),get=c=>mods[c]===undefined?(mods[c]=model(c)):mods[c],reach=14*scale,far=(noisy?30:24)**2,part=new Uint8Array(N);let any=0;
  for(let p=0;p<N;p++){const d=depth[p];if(!d||d>reach)continue;const o=other[p];if(o<0)continue;const c=comp[p],MX=get(c),MY=get(o);let x0,x1,x2,y0,y1,y2;
   if(MX){predict(MX,p);x0=pr[0];x1=pr[1];x2=pr[2];}else{const P=pal[lab[c]];x0=P.r;x1=P.g;x2=P.b;}
   if(MY){predict(MY,p);y0=pr[0];y1=pr[1];y2=pr[2];}else{const P=pal[lab[o]];y0=P.r;y1=P.g;y2=P.b;}
   const v0=y0-x0,v1=y1-x1,v2=y2-x2,gap=v0*v0+v1*v1+v2*v2;if(gap<400)continue;
   const i=p*3,u0=rgb[i]-x0,u1=rgb[i+1]-x1,u2=rgb[i+2]-x2,m=(u0*v0+u1*v1+u2*v2)/gap;if(m<(s.bandMix||.2)||m>.8||m*m*gap<64)continue;
   if((u0-m*v0)**2+(u1-m*v1)**2+(u2-m*v2)**2>far)continue;mark[p]=1;part[p]=Math.round(m*250);any++;}
  if(any){
   // tebal pita: jarak tiap piksel calon ke piksel bukan calon
   const inn=new Uint8Array(N),core=3*scale,grow=3*scale+2,list=new Int32Array(any);let end=0;
   for(let p=0;p<N;p++)inn[p]=mark[p]?250:0;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x;let v=inn[p];if(!v)continue;if(x&&inn[p-1]+1<v)v=inn[p-1]+1;if(y&&inn[p-W]+1<v)v=inn[p-W]+1;inn[p]=v;}
   for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const p=y*W+x;let v=inn[p];if(!v)continue;if(x<W-1&&inn[p+1]+1<v)v=inn[p+1]+1;if(y<H-1&&inn[p+W]+1<v)v=inn[p+W]+1;inn[p]=v;}
   // inti pita (cukup tebal) dan calon di sekitarnya
   for(let p=0;p<N;p++)if(mark[p]&&inn[p]>=core){mark[p]=2;inn[p]=0;list[end++]=p;}
   for(let read=0;read<end;read++){const p=list[read],x=p%W,d=inn[p];if(d>=grow)continue;let z;
    if(x&&mark[z=p-1]===1){mark[z]=2;inn[z]=d+1;list[end++]=z;}if(x<W-1&&mark[z=p+1]===1){mark[z]=2;inn[z]=d+1;list[end++]=z;}
    if(p>=W&&mark[z=p-W]===1){mark[z]=2;inn[z]=d+1;list[end++]=z;}if(p<N-W&&mark[z=p+W]===1){mark[z]=2;inn[z]=d+1;list[end++]=z;}}
   // undakan: kadar campuran diukur dari warna berlabel lebih kecil (lo) ke yang lebih besar (hi)
   const steps=new Map(),entries=new Map(),stepsFor=(lo,hi)=>{const key=lo*65536+hi;let k=steps.get(key);if(!k){const A=pal[lo],B=pal[hi],contrast=Math.hypot(A.r-B.r,A.g-B.g,A.b-B.b);k=contrast<40?3:contrast<110?5:7;steps.set(key,k);}return k;};
   for(let q=0;q<end;q++){const p=list[q],a=lab[comp[p]],b=lab[other[p]],lo=Math.min(a,b),hi=Math.max(a,b),k=stepsFor(lo,hi),f=a===lo?part[p]/250:1-part[p]/250,j=Math.min(k-1,Math.floor(f*k));if(j<1||j>k-2)continue;
    const key=(lo*65536+hi)*8+j,i=p*3;let e=entries.get(key);if(!e)entries.set(key,e={n:0,r:0,g:0,b:0,index:-1});e.n++;e.r+=rgb[i];e.g+=rgb[i+1];e.b+=rgb[i+2];}
   for(const e of entries.values()){if(e.n<8*unit||pal.length-n>600)continue;e.index=pal.length;softLab[pal.length]=1;pal.push({r:Math.round(e.r/e.n),g:Math.round(e.g/e.n),b:Math.round(e.b/e.n)});}
   let changed=false;
   for(let q=0;q<end;q++){const p=list[q],a=lab[comp[p]],b=lab[other[p]],lo=Math.min(a,b),hi=Math.max(a,b),k=stepsFor(lo,hi),f=a===lo?part[p]/250:1-part[p]/250,j=Math.min(k-1,Math.floor(f*k)),base=(lo*65536+hi)*8;
    const at=j=>j<1?lo:j>k-2?hi:(entries.get(base+j)||{index:-1}).index,own=at(j);if(own<0)continue;
    // batas undakan dihaluskan lewat medan cakupan: posisi piksel di antara dua ambang kadar
    const frac=f*k-j,next=at(frac<.5?j-1:j+1);
    if(own!==a){label[p]=own;set.owner[p]=own;changed=true;}
    if(next>=0&&next!==own){set.runner[p]=next;set.t[p]=.5+Math.min(frac,1-frac);}else if(own!==a){set.runner[p]=none;set.t[p]=1;}}
   mark.fill(0);
   if(changed){n1=pal.length;build();measure();}
  }
 }
 if(self.__dbg)self.__dbg('4-pita',label,W,H,pal);
 // Bagian di dalam bidang yang warnanya nyata berbeda dari bidangnya (kilau rambut, iris mata) tetapi
 // tidak kebagian warna di palet: dipisah menjadi bidang sendiri. Pita campuran di tepi bidang tidak.
 if(s.split!==false){
  const tau=(s.tau||(noisy?18:16))**2,minGap=s.minGap||22,minArea=8*size*unit,blob=scratch;let changed=false;
  for(let c=0,C0=C;c<C0;c++){
   if(S[c*K]<100*unit||softLab[lab[c]])continue;const M=model(c);if(!M)continue;const a0=start[c],b0=start[c+1],base=lab[c];
   let cand=0;for(let q=a0;q<b0;q++){const p=queue[q];if(depth[p]<weak)continue;predict(M,p);const i=p*3;if((rgb[i]-pr[0])**2+(rgb[i+1]-pr[1])**2+(rgb[i+2]-pr[2])**2>tau){mark[p]=1;cand++;}}
   if(cand>=minArea)for(let q=a0;q<b0;q++){const seed=queue[q];if(mark[seed]!==1)continue;
    let end=0,read=0,r=0,g=0,b=0,er=0,eg=0,eb=0,shallow=0;blob[end++]=seed;mark[seed]=2;
    while(read<end){const p=blob[read++],x=p%W,i=p*3;predict(M,p);r+=rgb[i];g+=rgb[i+1];b+=rgb[i+2];er+=pr[0];eg+=pr[1];eb+=pr[2];if(depth[p]<=weak+scale)shallow++;let z;
     if(x&&mark[z=p-1]===1){mark[z]=2;blob[end++]=z;}if(x<W-1&&mark[z=p+1]===1){mark[z]=2;blob[end++]=z;}if(p>=W&&mark[z=p-W]===1){mark[z]=2;blob[end++]=z;}if(p<N-W&&mark[z=p+W]===1){mark[z]=2;blob[end++]=z;}}
    let ok=end>=minArea&&shallow<.5*end;const own=[r/end,g/end,b/end],gap=(own[0]-er/end)**2+(own[1]-eg/end)**2+(own[2]-eb/end)**2;if(gap<minGap*minGap)ok=false;
    if(ok){let thick=false;const u=scale,v=scale*W;for(let q2=0;q2<end&&!thick;q2++){const p=blob[q2],x=p%W,y=(p/W)|0;if(x<u||y<u||x>=W-u||y>=H-u)continue;thick=mark[p-u]===2&&mark[p+u]===2&&mark[p-v]===2&&mark[p+v]===2&&mark[p-u-v]===2&&mark[p+u-v]===2&&mark[p-u+v]===2&&mark[p+u+v]===2;}ok=thick;}
    for(let q2=0;q2<end;q2++)mark[blob[q2]]=3;
    if(!ok)continue;
    // warna baru (dipakai bersama bila sudah ada yang serupa)
    let Kn=-1,best=noisy?12:8;for(let k=n;k<pal.length;k++){const e=Math.hypot(own[0]-pal[k].r,own[1]-pal[k].g,own[2]-pal[k].b);if(e<best){best=e;Kn=k;}}
    if(Kn<0&&pal.length-n<80){Kn=pal.length;pal.push({r:Math.round(own[0]),g:Math.round(own[1]),b:Math.round(own[2])});}
    if(Kn<0)continue;const P=pal[Kn];changed=true;
    // batas bagian itu = titik tengah antara warnanya dan warna bidang; tumbuh dari benihnya
    const near=p=>{predict(M,p);const i=p*3,eK=(rgb[i]-P.r)**2+(rgb[i+1]-P.g)**2+(rgb[i+2]-P.b)**2,eB=(rgb[i]-pr[0])**2+(rgb[i+1]-pr[1])**2+(rgb[i+2]-pr[2])**2,span=(P.r-pr[0])**2+(P.g-pr[1])**2+(P.b-pr[2])**2||1;return .5+(eB-eK)/(2*span);};
    const seeds=[];for(let q2=0;q2<end;q2++){const p=blob[q2],t=near(p);if(t>.5)seeds.push(p,t);}
    read=0;end=0;const take=(p,t)=>{label[p]=Kn;set.owner[p]=Kn;set.runner[p]=base;set.t[p]=Math.min(1,t);mark[p]=4;blob[end++]=p;};
    for(let q2=0;q2<seeds.length;q2+=2)take(seeds[q2],seeds[q2+1]);
    while(read<end){const p=blob[read++],x=p%W,y=(p/W)|0;
     for(const z of [x?p-1:-1,x<W-1?p+1:-1,y?p-W:-1,y<H-1?p+W:-1]){if(z<0||comp[z]!==c||mark[z]===4||label[z]!==base)continue;const t=near(z);
      if(t>.5&&depth[z]>=weak)take(z,t);else if(1-t>.5&&1-t<set.t[z]){set.runner[z]=Kn;set.t[z]=1-t;}}}
   }
   for(let q=a0;q<b0;q++)mark[queue[q]]=0;
  }
  if(changed){n1=pal.length;build();measure();}
 }
 if(self.__dbg)self.__dbg('5-pisah',label,W,H,pal);
 const layerOf=new Int32Array(C),models=new Array(C),extra=[],defs=[],exact=s.exact||7,join=Math.min(10,exact),n2=n1;
 const byArea=Array.from({length:C},(_,c)=>c).sort((a,b)=>(start[b+1]-start[b])-(start[a+1]-start[a]));
 const clusters=[];let gradients=0;
 const rgbOf=v=>`rgb(${v.map(x=>Math.max(0,Math.min(255,Math.round(x)))).join(',')})`;
 for(const c of byArea){
  layerOf[c]=lab[c];const M=models[c]=model(c);
  if(!M){
   // 5) bentuk tipis tanpa bagian dalam. Bila piksel-pikselnya adalah campuran warna palet bentuk itu dengan
   //    salah satu tetangganya (garis tipis sewarna bidang lain), warna palet dipertahankan dan lebarnya
   //    diatur lewat cakupan. Bila tidak (ujung garis yang memudar, sorot tipis), dipakai warna rata-rata
   //    pikselnya sendiri supaya ronanya benar.
   const a0=start[c],b0=start[c+1],area=b0-a0;if(s.recolor===false||!thin[c]||area<3*unit)continue;
   let r=0,g=0,b=0,total=0;const touch=new Map();
   for(let q=a0;q<b0;q++){const p=queue[q],x=p%W,y=(p/W)|0,i=p*3;r+=rgb[i];g+=rgb[i+1];b+=rgb[i+2];
    for(const z of [x?p-1:-1,x<W-1?p+1:-1,y?p-W:-1,y<H-1?p+W:-1]){if(z<0||comp[z]===c||label[z]<0)continue;total++;touch.set(label[z],(touch.get(label[z])||0)+1);}}
   const own=[r/area,g/area,b/area],P=pal[lab[c]],tol=(noisy?30:20)**2;if(Math.hypot(own[0]-P.r,own[1]-P.g,own[2]-P.b)<36)continue;
   let explained=false;for(const [k,count] of touch){if(count<total*.2)continue;const A=pal[k],v=[P.r-A.r,P.g-A.g,P.b-A.b],u=[own[0]-A.r,own[1]-A.g,own[2]-A.b],gap=v[0]*v[0]+v[1]*v[1]+v[2]*v[2];if(!gap)continue;
    const t=(u[0]*v[0]+u[1]*v[1]+u[2]*v[2])/gap;if(t>.15&&t<1.1&&(u[0]-t*v[0])**2+(u[1]-t*v[1])**2+(u[2]-t*v[2])**2<tol){explained=true;break;}}
   if(explained)continue;
   let best=14,to=-1,cluster=null;for(let k=0;k<n2;k++){const e=Math.hypot(own[0]-pal[k].r,own[1]-pal[k].g,own[2]-pal[k].b);if(e<best){best=e;to=k;}}
   for(const z of clusters){const e=Math.hypot(own[0]-z.mean[0],own[1]-z.mean[1],own[2]-z.mean[2]);if(e<best){best=e;cluster=z;to=-1;}}
   if(cluster)layerOf[c]=cluster.layer;else if(to>=0)layerOf[c]=to;else if(clusters.length<200){layerOf[c]=n2+extra.length;clusters.push({mean:own,layer:layerOf[c]});extra.push(rgbOf(own));}
   continue;}
  const mean=M.mean;
  if(M.prof&&gradients<600){const P=M.prof,id='vg'+(++gradients),keep=[0],tc=P.cx*P.ux+P.cy*P.uy;
   // titik henti yang sudah dijelaskan garis lurus antara tetangganya dibuang
   for(let k=1;k<BINS-1;k++){const a=P.cols[keep[keep.length-1]],b=P.cols[k+1],f=(k-keep[keep.length-1])/(k+1-keep[keep.length-1]);if(Math.max(...[0,1,2].map(ch=>Math.abs(P.cols[k][ch]-(a[ch]+(b[ch]-a[ch])*f))))>2)keep.push(k);}
   keep.push(BINS-1);
   defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${+(P.cx+P.ux*(P.lo-tc)+.5).toFixed(1)}" y1="${+(P.cy+P.uy*(P.lo-tc)+.5).toFixed(1)}" x2="${+(P.cx+P.ux*(P.lo+P.span-tc)+.5).toFixed(1)}" y2="${+(P.cy+P.uy*(P.lo+P.span-tc)+.5).toFixed(1)}">${keep.map(k=>`<stop offset="${+((k+.5)/BINS).toFixed(4)}" stop-color="${rgbOf(P.cols[k])}"/>`).join('')}</linearGradient>`);
   layerOf[c]=n2+extra.length;extra.push(`url(#${id})`);continue;}
  if(M.e&&gradients<600){
   // gradasi melingkar: warna = a + e × jarak², didekati beberapa titik henti sepanjang jari-jari
   let lo=Infinity,hi=0;for(let q=start[c];q<start[c+1];q++){const p=queue[q],t=((p%W-M.ox)/M.L-M.x0)**2+(((p/W|0)-M.oy)/M.L-M.y0)**2;if(t<lo)lo=t;if(t>hi)hi=t;}
   const r0=Math.sqrt(lo)*M.L,r1=Math.sqrt(hi)*M.L;
   if(r1-r0>4*scale){const id='vg'+(++gradients),stops=[];for(let i=0;i<=6;i++){const r=r0+(r1-r0)*i/6,q=(r/M.L)**2;stops.push(`<stop offset="${+(r/r1).toFixed(4)}" stop-color="${rgbOf([0,1,2].map(ch=>M.a[ch]+M.e[ch]*q))}"/>`);}
    defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${+(M.ox+M.L*M.x0+.5).toFixed(1)}" cy="${+(M.oy+M.L*M.y0+.5).toFixed(1)}" r="${+r1.toFixed(1)}">${stops.join('')}</radialGradient>`);
    layerOf[c]=n2+extra.length;extra.push(`url(#${id})`);continue;}
  }
  if(M.k&&gradients<600){const {mx,my,ux,uy,k}=M;
   let lo=Infinity,hi=-Infinity;for(let q=start[c];q<start[c+1];q++){const p=queue[q],t=((p%W-M.ox)/M.L-mx)*ux+(((p/W|0)-M.oy)/M.L-my)*uy;if(t<lo)lo=t;if(t>hi)hi=t;}
   // di luar rentang warna yang sah, gradasi berhenti (warna ujung menerus)
   for(let ch=0;ch<3;ch++){if(!k[ch])continue;const t0=(0-mean[ch])/k[ch],t1=(255-mean[ch])/k[ch];lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
   if((hi-lo)*M.L>4*scale){
    const at=t=>rgbOf([0,1,2].map(ch=>mean[ch]+k[ch]*t)),X=t=>+(M.ox+M.L*(mx+ux*t)+.5).toFixed(1),Y=t=>+(M.oy+M.L*(my+uy*t)+.5).toFixed(1),id='vg'+(++gradients);
    defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${X(lo)}" y1="${Y(lo)}" x2="${X(hi)}" y2="${Y(hi)}"><stop offset="0" stop-color="${at(lo)}"/><stop offset="1" stop-color="${at(hi)}"/></linearGradient>`);
    layerOf[c]=n2+extra.length;extra.push(`url(#${id})`);continue;}
  }
  models[c]={mean,ox:M.ox,oy:M.oy,L:M.L};
  // warna sendiri bila warna asli bidang jauh dari warna paletnya
  if(s.recolor===false)continue;
  // bidang kecil pada sumber berderau: rata-ratanya kurang pasti, jadi ambangnya lebih longgar
  const P=pal[lab[c]],own=Math.hypot(mean[0]-P.r,mean[1]-P.g,mean[2]-P.b);if(own<(noisy&&S[c*K]<40*unit?24:S[c*K]>=150*unit?exact:14))continue;
  let best=join,to=-1;for(let k=0;k<n2;k++){const e=Math.hypot(mean[0]-pal[k].r,mean[1]-pal[k].g,mean[2]-pal[k].b);if(e<best){best=e;to=k;}}
  let cluster=null;for(const z of clusters){const e=Math.hypot(mean[0]-z.mean[0],mean[1]-z.mean[1],mean[2]-z.mean[2]);if(e<best){best=e;cluster=z;to=-1;}}
  if(cluster)layerOf[c]=cluster.layer;
  else if(to>=0)layerOf[c]=to;
  else if(clusters.length<200){layerOf[c]=n2+extra.length;clusters.push({mean,layer:layerOf[c]});extra.push(rgbOf(mean));}
 }
 // seberapa baik cat ini menjelaskan gambar (dipakai mode otomatis untuk gambar bergradasi)
 let fit=1;if(s.measureFit){let good=0,total=0;for(let p=0;p<N;p++){if(depth[p]<weak)continue;const M=models[comp[p]];if(!M)continue;predict(M,p);const i=p*3;total++;if((rgb[i]-pr[0])**2+(rgb[i+1]-pr[1])**2+(rgb[i+2]-pr[2])**2<400)good++;}fit=total?good/total:0;}
 if(!extra.length&&n1===n&&!layerOf.some((v,c)=>v!==lab[c])){tidy();bridge();guard();return {...plain(),fit,gradients};}
 // label dan medan cakupan mengikuti lapisan baru
 for(let p=0;p<N;p++){const c=comp[p];if(c<0)continue;const L=layerOf[c];if(L!==lab[c]){label[p]=L;set.owner[p]=L;}}
 const R=2*scale;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=y*W+x,r=set.runner[p];if(r===none||(comp[p]>=0&&depth[p]>R+1))continue;let found=-1;
  for(let d=1;d<=R&&found<0;d++)for(let dy=-d;dy<=d&&found<0;dy++){const yy=y+dy;if(yy<0||yy>=H)continue;const step=dy===-d||dy===d?1:2*d;for(let dx=-d;dx<=d;dx+=step){const xx=x+dx;if(xx<0||xx>=W)continue;const z=comp[yy*W+xx];if(z>=0&&lab[z]===r){found=layerOf[z];break;}}}
  if(found>=0)set.runner[p]=found;}
 tidy();bridge();guard();
 if(self.__dbg)self.__dbg('6-akhir',label,W,H,pal,rgb,softLab,n);
 const colors=[...pal.map((p,k)=>flat(k)),...extra];
 return {layers:colors.map((color,k)=>({field:fieldFor(set,k),color})),defs:defs.length?`<defs>${defs.join('')}</defs>`:'',fit,gradients};
}
// ===== VektorKu V2 Pro 1.42: pixel art =====
// Pixel art = kotak-kotak sewarna pada sebuah grid. Di sini grid itu dicari dulu (jarak antarbaris dan antarkolom dari
// pola tepi yang berulang), tiap kotak diberi satu warna, lalu kotak sewarna yang bersebelahan digabung menjadi
// poligon yang sisinya hanya tegak dan mendatar. Hasilnya tajam di ukuran berapa pun dan titiknya sedikit.
// Mengembalikan null bila gambar tidak cukup mirip pixel art (kecuali dipaksa lewat force).
function pixelArt(d,w,h,s,ow,oh,force){
 const N=w*h;if(w<24||h<24)return null;
 // ---- profil tepi: seberapa besar beda warna antara kolom x dan x+1 (dijumlah ke bawah), juga untuk baris
 // diag: seberapa banyak tepi yang miring atau melengkung (beda warna ke kanan dan ke bawah sama-sama besar);
 //       pada pixel art hampir semua tepi tegak atau mendatar
 const gx=new Float64Array(w),gy=new Float64Array(h);let lo=0,hi=0;
 for(let y=0;y<h;y++){const row=y*w*4;for(let x=0;x<w;x++){const i=row+x*4,a=d[i+3];let ex=0,ey=0;
   if(x<w-1){const b=d[i+7];if(a>=128||b>=128)gx[x]+=ex=(a>=128)!==(b>=128)?300:Math.abs(d[i]-d[i+4])+Math.abs(d[i+1]-d[i+5])+Math.abs(d[i+2]-d[i+6]);}
   if(y<h-1){const j=i+w*4,b=d[j+3];if(a>=128||b>=128)gy[y]+=ey=(a>=128)!==(b>=128)?300:Math.abs(d[i]-d[j])+Math.abs(d[i+1]-d[j+1])+Math.abs(d[i+2]-d[j+2]);}
   if(ex+ey>40){if(ex<ey){lo+=ex;hi+=ey;}else{lo+=ey;hi+=ex;}}}}
 const diag=hi?lo/hi:1;
 const axis=(g,n)=>{
  let mean=0;for(let i=0;i<n-1;i++)mean+=g[i];mean/=n-1;if(!(mean>0))return null;
  const v=new Float64Array(n);for(let i=0;i<n-1;i++)v[i]=g[i]/mean;
  // autokorelasi: jarak ulang yang paling kuat
  let var0=0;for(let i=0;i<n-1;i++)var0+=(v[i]-1)**2;if(!(var0>0))return null;
  const maxLag=Math.min(96,Math.floor(n/6)),ac=new Float64Array(maxLag+2);
  for(let lag=2;lag<=maxLag+1;lag++){let sum=0;for(let i=0;i+lag<n-1;i++)sum+=(v[i]-1)*(v[i+lag]-1);ac[lag]=sum/var0;}
  let best=0;for(let lag=3;lag<=maxLag;lag++)if(ac[lag]>best)best=ac[lag];if(best<.12)return null;
  // periode dasar = puncak lokal terkecil yang cukup kuat (kelipatannya juga berpuncak)
  let lag0=0;for(let lag=3;lag<=maxLag;lag++)if(ac[lag]>=.6*best&&ac[lag]>=ac[lag-1]&&ac[lag]>=ac[lag+1]){lag0=lag;break;}
  if(!lag0)return null;
  // sisir: periode pecahan dan fase yang garis-garisnya paling banyak jatuh di tepi
  const at=x=>{if(x<0||x>n-2)return 0;const i=Math.floor(x),f=x-i;return v[i]*(1-f)+(i+1<n-1?v[i+1]:v[i])*f;};
  let P=lag0,PH=0,score=-1;
  for(let p=lag0-1;p<=lag0+1;p+=.02){for(let ph=0;ph<p;ph+=.25){let sum=0,c=0;for(let x=ph;x<n-1;x+=p){sum+=at(x);c++;}const sc=sum/c;if(sc>score){score=sc;P=p;PH=ph;}}}
  // garis demi garis dari tengah: tiap garis digeser ke puncak tepi terdekat (grid gambar AI tidak selalu rata)
  const sm=new Float64Array(n);for(let i=0;i<n-1;i++)sm[i]=(v[Math.max(0,i-1)]+2*v[i]+v[Math.min(n-2,i+1)])/4;
  const snap=x=>{const r=Math.max(1,Math.round(.22*P));let bi=-1,bv=1.15;for(let i=Math.max(0,Math.round(x)-r);i<=Math.min(n-2,Math.round(x)+r);i++)if(sm[i]>bv){bv=sm[i];bi=i;}
   if(bi<0)return {x,hit:false};const a=bi>0?sm[bi-1]:bv,c=bi<n-2?sm[bi+1]:bv,den=a-2*bv+c,off=den<0?Math.max(-.5,Math.min(.5,.5*(a-c)/den)):0;return {x:bi+off,hit:true};};
  // jarak antargaris diperbarui dari garis-garis yang benar-benar mengenai tepi, lalu ditelusuri ulang
  let lines,hits;const P0=P;if(!(P>=2))return null;
  for(let pass=0;pass<3;pass++){
   const k0=Math.round((n/2-PH)/P),start=snap(PH+k0*P),hit=[start.hit];lines=[start.x];hits=start.hit?1:0;
   // tiap garis harus maju paling sedikit setengah periode dari garis sebelumnya
   for(let x=start.x+P,prev=start.x;x<n-1-.25*P&&lines.length<4000;){const z=snap(x),at=Math.max(z.x,prev+.5*P);lines.push(at);hit.push(z.hit);if(z.hit)hits++;prev=at;x=at+P;}
   for(let x=start.x-P,prev=start.x;x>.25*P-1&&lines.length<4000;){const z=snap(x),at=Math.min(z.x,prev-.5*P);lines.unshift(at);hit.unshift(z.hit);if(z.hit)hits++;prev=at;x=at-P;}
   if(lines.length>=4000)return null;
   const gaps=[];for(let k=1;k<lines.length;k++)if(hit[k]&&hit[k-1])gaps.push(lines[k]-lines[k-1]);if(gaps.length<4)break;
   // rata-rata jarak di sekitar median (buang yang menyimpang)
   gaps.sort((a,b)=>a-b);const med=gaps[gaps.length>>1];let sum=0,c=0;for(const g of gaps)if(Math.abs(g-med)<=.15*med){sum+=g;c++;}const P2=c?sum/c:med;
   if(!(P2>=.8*P0&&P2<=1.25*P0)||Math.abs(P2-P)<.01*P)break;P=P2;PH=start.x-Math.floor(start.x/P)*P;}
  // posisi garis = batas antara piksel i dan i+1, jadi koordinatnya i+1
  const pos=lines.map(x=>x+1);
  // bila semua garis nyaris tepat pada grid rata, pakai grid rata itu (angka lebih bersih)
  {const m=pos.length;if(m>=3){let sk=0,sx=0,skk=0,skx=0;for(let k=0;k<m;k++){sk+=k;sx+=pos[k];skk+=k*k;skx+=k*pos[k];}const b=(m*skx-sk*sx)/(m*skk-sk*sk),a=(sx-b*sk)/m;let worst=0;for(let k=0;k<m;k++)worst=Math.max(worst,Math.abs(pos[k]-(a+b*k)));
    if(worst<.6)for(let k=0;k<m;k++)pos[k]=a+b*k;}}
  // tepi gambar menjadi garis pertama dan terakhir; kotak sisa yang terlalu tipis dilebur ke tetangganya
  while(pos.length&&pos[0]<.45*P)pos.shift();while(pos.length&&pos[pos.length-1]>n-.45*P)pos.pop();
  pos.unshift(0);pos.push(n);
  // seberapa banyak energi tepi yang berada di dekat garis grid
  let near=0,total=0;{let k=0;for(let i=0;i<n-1;i++){total+=g[i];while(k+1<pos.length&&pos[k+1]<i+1)k++;const dmin=Math.min(Math.abs(i+1-pos[k]),k+1<pos.length?Math.abs(pos[k+1]-(i+1)):1e9);if(dmin<=Math.max(1.5,.2*P))near+=g[i];}}
  return {period:P,ac:ac[lag0],score,pos,hitShare:hits/lines.length,edgeShare:total?near/total:0};};
 const X=axis(gx,w),Y=axis(gy,h);if(!X||!Y)return null;
 const ratio=X.period/Y.period,cols=X.pos.length-1,rows=Y.pos.length-1;
 if(self.__px)self.__px.push({px:X.period,py:Y.period,acx:X.ac,acy:Y.ac,ex:X.edgeShare,ey:Y.edgeShare,hx:X.hitShare,hy:Y.hitShare,cols,rows,diag});
 if(cols<6||rows<6||cols*rows>260000)return null;
 // Uji geser: bila grid digeser setengah kotak, isi tiap kotak menjadi jauh lebih beragam pada pixel art (kotak-kotaknya
 // jadi menumpang di atas tepi), sedangkan pada gambar biasa hampir tidak berubah. Dihitung pada kisi contoh supaya cepat.
 const spread=shift=>{let sum=0,cnt=0;const stepJ=Math.max(1,Math.floor(rows/60)),stepI=Math.max(1,Math.floor(cols/60));
  for(let j=0;j+1<rows;j+=stepJ){const hY=Y.pos[j+1]-Y.pos[j],y0=Math.round(Y.pos[j]+(shift?.5:0)*hY+.22*hY),y1=Math.round(Y.pos[j]+(shift?.5:0)*hY+.78*hY);if(y1>h)continue;
   for(let i=0;i+1<cols;i+=stepI){const wX=X.pos[i+1]-X.pos[i],x0=Math.round(X.pos[i]+(shift?.5:0)*wX+.22*wX),x1=Math.round(X.pos[i]+(shift?.5:0)*wX+.78*wX);if(x1>w)continue;
    let n=0,s1=0,s2=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const q=(y*w+x)*4;if(d[q+3]<128)continue;const v=d[q]+d[q+1]+d[q+2];n++;s1+=v;s2+=v*v;}
    if(n>1){sum+=s2/n-(s1/n)**2;cnt++;}}}
  return cnt?sum/cnt:0;},v0=spread(false),v1=spread(true),vr=v1/Math.max(1,v0);
 if(self.__px){self.__px[self.__px.length-1].vr=vr;self.__px[self.__px.length-1].v0=v0;self.__px[self.__px.length-1].v1=v1;}
 // Otomatis hanya bila polanya jelas: (a) pixel art tajam: pergeseran setengah kotak mengubah isi kotak secara drastis;
 // (b) pixel art buram (buatan AI, hasil perbesaran): perubahan itu sedang, jadi pola ulangnya harus kuat dan kotaknya tidak terlalu kecil.
 if(!force){const acMin=Math.min(X.ac,Y.ac),pMin=Math.min(X.period,Y.period);
  if(pMin<2.6||ratio<.85||ratio>1.18||!((vr>=20&&acMin>=.5)||(vr>=3&&pMin>=5&&acMin>=.4&&diag<=.45)))return null;}

 // ---- warna tiap kotak: warna terbanyak di bagian dalamnya (bukan rata-rata, supaya kotak yang sedikit tergeser dari
 //      grid tidak menjadi warna campuran dua tetangganya); tepi kotak yang buram tidak ikut
 const cell=new Float32Array(cols*rows*3),solid=new Uint8Array(cols*rows);let miss=0,seen=0;
 const mx=Math.max(1,Math.round(.22*X.period)),my=Math.max(1,Math.round(.22*Y.period)),hc=new Uint16Array(4096),hs=new Float32Array(4096*3),touched=[];
 for(let j=0;j<rows;j++){const y0=Math.round(Y.pos[j]),y1=Math.round(Y.pos[j+1]),ya=Math.min(y1-1,y0+my),yb=Math.max(ya+1,y1-my);
  for(let i=0;i<cols;i++){const x0=Math.round(X.pos[i]),x1=Math.round(X.pos[i+1]),xa=Math.min(x1-1,x0+mx),xb=Math.max(xa+1,x1-mx);let a=0,c=0;touched.length=0;
   for(let y=ya;y<yb;y++)for(let x=xa;x<xb;x++){const q=(y*w+x)*4;c++;if(d[q+3]<128)continue;a++;const key=(d[q]>>4)<<8|(d[q+1]>>4)<<4|(d[q+2]>>4);if(!hc[key])touched.push(key);hc[key]++;hs[key*3]+=d[q];hs[key*3+1]+=d[q+1];hs[key*3+2]+=d[q+2];}
   let top=-1,most=0;for(const key of touched)if(hc[key]>most){most=hc[key];top=key;}
   const k=j*cols+i;
   if(a*2>=c&&a){const br=hs[top*3]/most,bg=hs[top*3+1]/most,bb=hs[top*3+2]/most;let r=0,g=0,b=0,m=0;
    for(let y=ya;y<yb;y++)for(let x=xa;x<xb;x++){const q=(y*w+x)*4;if(d[q+3]<128)continue;seen++;const e=Math.abs(d[q]-br)+Math.abs(d[q+1]-bg)+Math.abs(d[q+2]-bb);if(e<=36){r+=d[q];g+=d[q+1];b+=d[q+2];m++;}if(e>60)miss++;}
    cell[k*3]=m?r/m:br;cell[k*3+1]=m?g/m:bg;cell[k*3+2]=m?b/m:bb;
    // "Putih jadi transparan": kotak putih dianggap kosong
    solid[k]=s.removeWhite&&cell[k*3]>=s.whiteLevel&&cell[k*3+1]>=s.whiteLevel&&cell[k*3+2]>=s.whiteLevel?0:1;}
   for(const key of touched){hc[key]=0;hs[key*3]=hs[key*3+1]=hs[key*3+2]=0;}}}
 const flat=seen?1-miss/seen:0;if(self.__px)self.__px[self.__px.length-1].flat=flat;
 if(!seen||(!force&&flat<.8))return null;
 // ---- palet: warna kotak yang berdekatan dijadikan satu
 const K=cols*rows,label=new Int32Array(K).fill(-1);let tol=s.pixelTol||18,pal;
 for(let round=0;round<8;round++){pal=[];const bins=new Map();
  for(let k=0;k<K;k++){if(!solid[k])continue;const key=(cell[k*3]>>3)<<10|(cell[k*3+1]>>3)<<5|(cell[k*3+2]>>3);let e=bins.get(key);if(!e)bins.set(key,e=[0,0,0,0]);e[0]++;e[1]+=cell[k*3];e[2]+=cell[k*3+1];e[3]+=cell[k*3+2];}
  const order=[...bins.values()].sort((a,b)=>b[0]-a[0]);
  for(const e of order){const r=e[1]/e[0],g=e[2]/e[0],b=e[3]/e[0];let hit=null;for(const p of pal){const t=tol*(1+.8*Math.max(0,1-Math.max(r,g,b,p.r,p.g,p.b)/70));if((p.r-r)**2+(p.g-g)**2+(p.b-b)**2<=t*t){hit=p;break;}}
   if(hit){hit.sr+=e[1];hit.sg+=e[2];hit.sb+=e[3];hit.n+=e[0];}else pal.push({r,g,b,sr:e[1],sg:e[2],sb:e[3],n:e[0]});}
  for(const p of pal){p.r=p.sr/p.n;p.g=p.sg/p.n;p.b=p.sb/p.n;}
  if(pal.length<=(s.pixelColors||96))break;tol*=1.3;}
 for(let k=0;k<K;k++){if(!solid[k])continue;let best=Infinity,at=0;for(let q=0;q<pal.length;q++){const p=pal[q],e=(p.r-cell[k*3])**2+(p.g-cell[k*3+1])**2+(p.b-cell[k*3+2])**2;if(e<best){best=e;at=q;}}label[k]=at;}
 // ---- susun bertumpuk: warna terluas di bawah. Lubang yang seluruhnya tertutup lapisan atas diisi; tepi yang berada
 //      di bawah lapisan atas digeser sedikit ke luar supaya sambungan antarwarna tidak menyisakan garis tipis.
 const count=new Int32Array(pal.length);let empty=0;for(let k=0;k<K;k++){if(label[k]<0)empty++;else count[label[k]]++;}
 const order=[...pal.keys()].filter(q=>count[q]).sort((a,b)=>count[b]-count[a]),rankOf=new Int32Array(pal.length).fill(-1);order.forEach((q,r)=>{rankOf[q]=r;});
 const rank=new Int32Array(K);for(let k=0;k<K;k++)rank[k]=label[k]<0?-1:rankOf[label[k]];
 const delta=Math.max(.4,Math.min(1,.1*Math.min(X.period,Y.period))),f=v=>+v.toFixed(2),out=[],mask=new Uint8Array(K),queue=new Int32Array(K);let anchors=0;
 const color=q=>`rgb(${Math.round(pal[q].r)},${Math.round(pal[q].g)},${Math.round(pal[q].b)})`;
 const top=order.length-1;
 for(let r=0;r<=top;r++){
  if(r===0&&!empty){out.push(`<path fill="${color(order[0])}" d="M0 0L${w} 0L${w} ${h}L0 ${h}Z"/>`);anchors+=4;continue;}
  for(let k=0;k<K;k++)mask[k]=rank[k]===r?1:0;
  if(r<top){let end=0;                                     // "terbuka": kotak lapisan atas yang tersambung ke lapisan bawah atau area kosong
   for(let k=0;k<K;k++){if(rank[k]<=r)continue;const i=k%cols,j=(k/cols)|0;if((i&&rank[k-1]<r)||(i<cols-1&&rank[k+1]<r)||(j&&rank[k-cols]<r)||(j<rows-1&&rank[k+cols]<r)){mask[k]=2;queue[end++]=k;}}
   for(let q=0;q<end;q++){const k=queue[q],i=k%cols,j=(k/cols)|0;for(const z of [i?k-1:-1,i<cols-1?k+1:-1,j?k-cols:-1,j<rows-1?k+cols:-1])if(z>=0&&!mask[z]&&rank[z]>r){mask[z]=2;queue[end++]=z;}}
   for(let k=0;k<K;k++){if(mask[k]===2)mask[k]=0;else if(!mask[k]&&rank[k]>r)mask[k]=1;}}
  // sisi-sisi batas, searah jarum jam (isi di kanan arah jalan); hid = di seberangnya ada lapisan atas
  const M=(i,j)=>i>=0&&j>=0&&i<cols&&j<rows&&mask[j*cols+i]===1,H=(i,j)=>i>=0&&j>=0&&i<cols&&j<rows&&rank[j*cols+i]>r?1:0,VW=cols+1,edges=new Map();
  const add=(x0,y0,dir,hid)=>{const key=y0*VW+x0;let e=edges.get(key);if(!e)edges.set(key,e=[]);e.push({dir,hid,used:false});};
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){if(!M(i,j))continue;
   if(!M(i,j-1))add(i,j,0,H(i,j-1));if(!M(i+1,j))add(i+1,j,1,H(i+1,j));if(!M(i,j+1))add(i+1,j+1,2,H(i,j+1));if(!M(i-1,j))add(i,j+1,3,H(i-1,j));}
  const DX=[1,0,-1,0],DY=[0,1,0,-1],NX=[0,1,0,-1],NY=[-1,0,1,0],parts=[];
  for(const [key,list] of edges)for(const first of list){if(first.used)continue;
   // telusuri satu putaran; di titik temu diagonal dipilih belokan ke kanan supaya dua kotak yang hanya bersentuhan sudut tetap terpisah
   const loop=[];let x=key%VW,y=(key/VW)|0,e=first;
   for(let guard=0;guard<4*K+8;guard++){e.used=true;loop.push({x,y,dir:e.dir,hid:e.hid});x+=DX[e.dir];y+=DY[e.dir];const cand=edges.get(y*VW+x);if(!cand)break;let next=null;
    for(const turn of [1,0,3]){const want=(e.dir+turn)%4;next=cand.find(c=>!c.used&&c.dir===want);if(next)break;}
    if(!next)break;e=next;}
   // gabung sisi segaris yang sama jenisnya, lalu tulis titik-titiknya dengan geseran pada sisi tersembunyi
   const runs=[];for(const u of loop){const t=runs[runs.length-1];if(t&&t.dir===u.dir&&t.hid===u.hid)continue;runs.push(u);}
   if(runs.length>1&&runs[0].dir===runs[runs.length-1].dir&&runs[0].hid===runs[runs.length-1].hid)runs.shift();
   if(runs.length<4)continue;const pts=[];
   for(let q=0;q<runs.length;q++){const cur=runs[q],prev=runs[(q+runs.length-1)%runs.length],vx=X.pos[cur.x],vy=Y.pos[cur.y];
    const ox1=NX[prev.dir]*prev.hid*delta,oy1=NY[prev.dir]*prev.hid*delta,ox2=NX[cur.dir]*cur.hid*delta,oy2=NY[cur.dir]*cur.hid*delta;
    if(prev.dir===cur.dir){pts.push([vx+ox1,vy+oy1],[vx+ox2,vy+oy2]);}else pts.push([vx+ox1+ox2,vy+oy1+oy2]);}
   anchors+=pts.length;parts.push('M'+pts.map(p=>f(Math.max(0,Math.min(w,p[0])))+' '+f(Math.max(0,Math.min(h,p[1])))).join('L')+'Z');}
  // tanpa fill-rule (nonzero): putaran lubang berlawanan arah, sedangkan dua putaran yang saling menumpang di sudut tetap terisi
  if(parts.length)out.push(`<path fill="${color(order[r])}" d="${parts.join('')}"/>`);
 }
 if(!out.length)return null;
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${w} ${h}">${out.join('')}</svg>`,engine:'Pixel art',note:` Grid ${cols} × ${rows} kotak, ${order.length} warna.`,pixel:{cols,rows,colors:order.length,period:[X.period,Y.period],flat}};
}
function fineDetailShare(d,w,h){
 const W2=w>>1,H2=h>>1;if(W2<8||H2<8)return 1;const half=new Float32Array(W2*H2*3);
 for(let y=0;y<H2;y++)for(let x=0;x<W2;x++){const o=(y*W2+x)*3;for(let c=0;c<3;c++){let v=0;for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]])v+=d[((2*y+dy)*w+2*x+dx)*4+c];half[o+c]=v/4;}}
 let big=0,n=0;
 for(let y=0;y<H2*2;y+=1)for(let x=0;x<W2*2;x+=1){const i=(y*w+x)*4;if(d[i+3]<250)continue;n++;
  const fx=Math.min(W2-1.001,Math.max(0,(x+.5)/2-.5)),fy=Math.min(H2-1.001,Math.max(0,(y+.5)/2-.5)),ix=fx|0,iy=fy|0,ax=fx-ix,ay=fy-iy;let dmax=0;
  for(let c=0;c<3;c++){const p=(r,q)=>half[(q*W2+r)*3+c];const v=(p(ix,iy)*(1-ax)+p(ix+1,iy)*ax)*(1-ay)+(p(ix,iy+1)*(1-ax)+p(ix+1,iy+1)*ax)*ay;const e=Math.abs(v-d[i+c]);if(e>dmax)dmax=e;}
  if(dmax>60)big++;}
 return n?big/n:0;
}
function colorLogoCandidate(d,w,h,s,ow,oh){
 const forced=s.mode==='logoColor'||s.mode==='logo',pal=s.lookalike===true?mergeLookalikeColors(d,w,h,logoPalette(d,w,h,s.flatPeaks)):s.lookalike===false?logoPalette(d,w,h,s.flatPeaks):mergeDarkTwins(d,w,h,logoPalette(d,w,h,s.flatPeaks)),interiorColors=logoInteriorColors(d,w,h,pal);
 if(s.extraColors&&pal.length)for(const c of s.extraColors){if(pal.some(p=>Math.hypot(p.r-c[0],p.g-c[1],p.b-c[2])<(s.extraGap??24)))continue;const q={r:c[0],g:c[1],b:c[2],forced:true};pal.push(q);interiorColors.add(q);}
 let hasFlatMixture=false,again=true;while(again&&pal.length>2){again=false;let best=-1,error=16*16;for(let k=0;k<pal.length;k++)for(let a=0;a<pal.length;a++)for(let b=a+1;b<pal.length;b++){if(k===a||k===b)continue;const A=pal[a],B=pal[b],P=pal[k],v=[B.r-A.r,B.g-A.g,B.b-A.b],u=[P.r-A.r,P.g-A.g,P.b-A.b],den=v.reduce((n,x)=>n+x*x,0),t=u.reduce((n,x,i)=>n+x*v[i],0)/den;if(t<.04||t>.96)continue;const e=u.reduce((n,x,i)=>n+(x-t*v[i])**2,0);if(e<16*16&&interiorColors.has(pal[k]))hasFlatMixture=true;if(e<error&&!interiorColors.has(pal[k])){error=e;best=k;}}if(best>=0){pal.splice(best,1);again=true;}}
 if(!pal.length)return null;
 if(s.mode!=='logoColor'&&pal.length<3)return null;
 if(s.interior!==false){interiorPalette(d,w,h,pal,false);if(rawPixels&&rawPixels!==d&&rawPixels.length===d.length)interiorPalette(rawPixels,w,h,pal,true);}
 let allow=s.fringe===false?new Uint32Array(w*h):plausibleColors(d,w,h,pal,s.sourceNoisy,s);
 // Warna palet tanpa bidang rata yang hampir seluruh pikselnya hanyalah campuran antialias dibuang.
 for(let round=0;round<3&&allow.stats&&pal.length>2;round++){const dead=allow.stats.map((z,k)=>k>0&&!pal[k].forced&&!z.core&&z.own<Math.max(8,z.total*.2));if(!dead.some(Boolean))break;for(let k=pal.length-1;k>0&&pal.length>2;k--)if(dead[k])pal.splice(k,1);allow=plausibleColors(d,w,h,pal,s.sourceNoisy,s);}
 // Otomatis: gambar berwarna datar, 3 sampai 24 warna. Gradasi dan foto ditolak lewat uji batas lunak di bawah.
 if(!forced&&pal.length<3)return null;
 const dist=(r,g,b,p)=>(r-p.r)**2+(g-p.g)**2+(b-p.b)**2;
 let total=0,close=0,ink=0,inkClose=0;
 for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;let nearest=Infinity,k=0;for(let j=0;j<pal.length;j++){const e=dist(d[i],d[i+1],d[i+2],pal[j]);if(e<nearest){nearest=e;k=j;}}total++;if(nearest<24*24)close++;if(k!==0){ink++;if(nearest<24*24)inkClose++;}}
 if(!forced&&(close/Math.max(1,total)<.75||inkClose/Math.max(1,ink)<.55))return null;
 const smooth=close/Math.max(1,total)<.90||softBoundaryShare(d,w,h,pal.some(p=>p.peak)?pal.filter(p=>!p.peak):pal)>.25,soft=!forced&&smooth;if(soft&&(s.regions===false||s.gradients===false))return null;
 postMessage({phase:'Menjaga warna utama, sudut, dan celah logo…'});
 const mid=s.up2!==false&&Math.max(w,h)>768&&Math.max(w,h)<=1600&&w*h<=1.25e6&&(s.fineShare??(s.fineShare=fineDetailShare(d,w,h)))>=(s.fineMin??.001),scale=Math.max(w,h)<=512?3:Math.max(w,h)<=768||mid?2:1,W=w*scale,H=h*scale,N=W*H;
 const tolerance=s.quality==='simple'?.35:.15;
 const traceLayers=(list,label,opaque)=>stackTrace(list,label,W,H,scale,opaque,(layer,mask,box)=>{if(!mask)return `<path fill="${layer.color}" d="M0 0 L${W} 0 L${W} ${H} L0 ${H} Z"/>`;const path=preciseLogoPath(mask,W,H,scale,layer.color,s,tolerance,s.subpixel===false?null:layer.field,box);return /d="\s*"/.test(path)?'':path;},true);
 const pale=!soft&&!hasFlatMixture&&!s.removeWhite&&s.pale!==false?paleLogoMasks(d,w,h,pal,scale,allow,s.sourceNoisy):null;
 if(pale){const paths=[`<path fill="rgb(${pale.bg.r},${pale.bg.g},${pale.bg.b})" d="M0 0 L${W} 0 L${W} ${H} L0 ${H} Z"/>`];paths.push(...traceLayers(pale.layers,pale.label,false));return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${W} ${H}">${paths.join('')}</svg>`,engine:'Warna datar',note:' Periksa teks kecil dan sudut sebelum mengunduh.'};}
 const label=new Int16Array(N).fill(-1),set=newFieldSet(N,true),rgb=new Uint8Array(N*3);let visible=0;
 // Gambar kecil diperbesar 2-3x untuk diproses. Interpolasi kubik (Catmull-Rom) menjaga tepi tetap curam dan kilau kecil
 // tidak luntur seperti pada interpolasi linear; hasilnya dibatasi ke rentang warna 2x2 terdekat supaya tidak ada lingkar.
 const cr=t=>{const a=Math.abs(t);return a<1?1.5*a*a*a-2.5*a*a+1:a<2?-.5*a*a*a+2.5*a*a-4*a+2:0;};
 let seeThrough=false;for(let i=3;i<d.length;i+=4)if(d[i]<255){seeThrough=true;break;}
 // gambar transparan tetap linear: tepi alfa kubik menimbulkan pinggiran
 const pixel=s.cubic===false||seeThrough?(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let r=0,g=0,b=0,a=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const xx=Math.min(w-1,Math.max(0,ix+dx)),yy=Math.min(h-1,Math.max(0,iy+dy)),i=(yy*w+xx)*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy)*d[i+3]/255;a+=weight;r+=d[i]*weight;g+=d[i+1]*weight;b+=d[i+2]*weight;}return a?[r/a,g/a,b/a,a*255]:[0,0,0,0];}
 :(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let r=0,g=0,b=0,a=0,ws=0;const lo=[255,255,255],hi=[0,0,0];
  for(let dy=-1;dy<=2;dy++){const wy=cr(dy-fy),yy=Math.min(h-1,Math.max(0,iy+dy));for(let dx=-1;dx<=2;dx++){const wx=cr(dx-fx),xx=Math.min(w-1,Math.max(0,ix+dx)),i=(yy*w+xx)*4,al=d[i+3]/255,weight=wx*wy;
   ws+=weight;a+=weight*al;r+=d[i]*weight*al;g+=d[i+1]*weight*al;b+=d[i+2]*weight*al;
   if(dx>=0&&dx<=1&&dy>=0&&dy<=1&&al>0){for(let c=0;c<3;c++){if(d[i+c]<lo[c])lo[c]=d[i+c];if(d[i+c]>hi[c])hi[c]=d[i+c];}}}}
  if(a<=1e-3)return [0,0,0,0];const out=[r/a,g/a,b/a];for(let c=0;c<3;c++)out[c]=Math.max(lo[c],Math.min(hi[c],out[c]));return [out[0],out[1],out[2],Math.max(0,Math.min(255,a/ws*255))];};
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const p=scale===1?d.subarray((y*w+x)*4,(y*w+x)*4+4):pixel((x+.5)/scale-.5,(y+.5)/scale-.5);if(!p[3])continue;const can=plausibleAt(allow,w,h,(x+.5)/scale-.5,(y+.5)/scale-.5);let best=Infinity,k=-1,next=Infinity,k2=-1;for(let j=0;j<pal.length;j++){if(!(can>>j&1))continue;const e=dist(p[0],p[1],p[2],pal[j]);if(e<best){next=best;k2=k;best=e;k=j;}else if(e<next){next=e;k2=j;}}
  // Posisi di antara warna terdekat dan pesaingnya: 0,5 tepat di batas, 1 pada warna murni.
  const q=y*W+x,white=s.removeWhite&&p[0]>=s.whiteLevel&&p[1]>=s.whiteLevel&&p[2]>=s.whiteLevel;let t=1;if(k2>=0){const A=pal[k],B=pal[k2],gap=(A.r-B.r)**2+(A.g-B.g)**2+(A.b-B.b)**2;t=gap?Math.min(1,.5+(next-best)/(2*gap)):1;}
  set.owner[q]=k;set.runner[q]=k2<0?set.none:k2;set.t[q]=t;set.alpha[q]=white?0:Math.round(p[3]);rgb[q*3]=p[0];rgb[q*3+1]=p[1];rgb[q*3+2]=p[2];
  if(p[3]<128||white)continue;label[q]=k;visible++;}
 if(!visible)throw Error('Tidak ada bentuk tersisa. Matikan penghapus putih.');
 const color=k=>`rgb(${pal[k].r},${pal[k].g},${pal[k].b})`;
 const paint=s.regions===false?{layers:pal.map((p,k)=>({field:fieldFor(set,k),color:color(k)})),defs:''}:regionPaint(label,set,rgb,W,H,scale,pal,{...s,measureFit:soft,unify:s.unify!==false&&!smooth});
 if(soft&&!(paint.gradients>0&&paint.fit>=.9))return null;
 const paths=traceLayers(paint.layers,label,visible===N);
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${W} ${H}">${paint.defs}${paths.join('')}</svg>`,engine:paint.gradients?'Warna dan gradasi':'Warna datar',note:scale>1?' Detail diperiksa pada sampel lebih rapat; bentuk yang hilang dari sumber tidak dipulihkan.':''};
}

// Remove only a nearly uniform background connected to image edges.
function removeOuterBackground(data,w,h){
 const bins=new Map(),edges=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!x||!y||x===w-1||y===h-1)edges.push(y*w+x);
 let opaque=0;
 for(const p of edges){const i=p*4;if(data[i+3]<128)continue;opaque++;const key=((data[i]>>4)<<8)|((data[i+1]>>4)<<4)|(data[i+2]>>4);let bin=bins.get(key);if(!bin){bin=[0,0,0,0];bins.set(key,bin);}for(let c=0;c<3;c++)bin[c]+=data[i+c];bin[3]++;}
 if(opaque<edges.length*.6)return {data,note:' Latar dari tepi tidak dihapus: sebagian besar tepi sudah transparan.'};
 const best=[...bins.values()].sort((a,b)=>b[3]-a[3])[0],bg=best.slice(0,3).map(v=>v/best[3]);
 const matches=p=>{const i=p*4;return data[i+3]<128||(data[i]-bg[0])**2+(data[i+1]-bg[1])**2+(data[i+2]-bg[2])**2<=36*36;};
 if(edges.filter(p=>data[p*4+3]>=128&&matches(p)).length<edges.length*.6)return {data,note:' Latar dari tepi tidak dihapus: warna tepi terlalu beragam.'};
 const orig=data.slice(),seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let read=0,end=0,removed=0;
 const add=p=>{if(p<0||seen[p]||!matches(p))return;seen[p]=1;queue[end++]=p;};
 for(const p of edges)add(p);
 while(read<end){const p=queue[read++],x=p%w,y=(p/w)|0,i=p*4;if(data[i+3])removed++;data[i]=data[i+1]=data[i+2]=data[i+3]=0;if(x)add(p-1);if(x<w-1)add(p+1);if(y)add(p-w);if(y<h-1)add(p+w);}
 let holes=0;
 if(removed){
  // tinta dominan: piksel non-latar (bukan antialias) yang dekat dengan warna terbanyak
  const D=p=>{const i=p*4;return (orig[i]-bg[0])**2+(orig[i+1]-bg[1])**2+(orig[i+2]-bg[2])**2;},hb=new Map();let fg=0;
  for(let p=0;p<w*h;p++){if(seen[p]||orig[p*4+3]<128||D(p)<60*60)continue;fg++;const i=p*4,k=((orig[i]>>4)<<8)|((orig[i+1]>>4)<<4)|(orig[i+2]>>4);let b=hb.get(k);if(!b){b=[0,0,0,0];hb.set(k,b);}b[0]+=orig[i];b[1]+=orig[i+1];b[2]+=orig[i+2];b[3]++;}
  const top=[...hb.values()].sort((a,b)=>b[3]-a[3])[0];
  if(top&&fg>0){const c=[top[0]/top[3],top[1]/top[3],top[2]/top[3]];let near=0;
   for(let p=0;p<w*h;p++){if(seen[p]||orig[p*4+3]<128||D(p)<60*60)continue;const i=p*4;if((orig[i]-c[0])**2+(orig[i+1]-c[1])**2+(orig[i+2]-c[2])**2<=60*60)near++;}
   if(near/fg>=.7){read=end=0;for(let p=0;p<w*h;p++)if(!seen[p]&&orig[p*4+3]>=128&&D(p)<=36*36){seen[p]=1;queue[end++]=p;}
    while(read<end){const p=queue[read++],i=p*4;if(data[i+3])holes++;data[i]=data[i+1]=data[i+2]=data[i+3]=0;}}}
  matteEdges(data,orig,seen,w,h,bg);}
 return {data,note:removed?(holes?' Latar polos dihapus, termasuk lubang huruf/bentuk.':' Latar polos dari tepi dihapus; area tertutup dipertahankan.'):' Tidak ada latar yang dihapus.'};
}
function matteEdges(data,orig,seen,w,h,bg){
 const D=p=>{const i=p*4;return Math.sqrt((orig[i]-bg[0])**2+(orig[i+1]-bg[1])**2+(orig[i+2]-bg[2])**2);},band=[];
 for(let p=0;p<w*h;p++){if(orig[p*4+3]<128)continue;const x=p%w,y=(p/w)|0;let near=false;
  if(seen[p])near=D(p)>10;else for(let dy=-2;dy<=2&&!near;dy++)for(let dx=-2;dx<=2;dx++){const X=x+dx,Y=y+dy;if(X>=0&&Y>=0&&X<w&&Y<h&&seen[Y*w+X]){near=true;break;}}
  if(near)band.push(p);}
 const out=[];
 for(const p of band){const x=p%w,y=(p/w)|0;let best=-1,f=-1;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h)continue;const q=Y*w+X;if(seen[q]||orig[q*4+3]<128)continue;const e=D(q);if(e>best){best=e;f=q;}}
  if(f<0||best<48){for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h)continue;const q=Y*w+X;if(seen[q]||orig[q*4+3]<128)continue;const e=D(q);if(e>best){best=e;f=q;}}}
  if(f<0||best<48){if(!seen[p]&&D(p)<100)out.push([p*4,orig[p*4],orig[p*4+1],orig[p*4+2],0]);continue;}const i=p*4,j=f*4,v=[orig[j]-bg[0],orig[j+1]-bg[1],orig[j+2]-bg[2]],c=[orig[i]-bg[0],orig[i+1]-bg[1],orig[i+2]-bg[2]];
  const a=Math.max(0,Math.min(1,(c[0]*v[0]+c[1]*v[1]+c[2]*v[2])/(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])));
  out.push([i,orig[j],orig[j+1],orig[j+2],a<.04?0:Math.round(a*orig[i+3])]);}
 for(const [i,r,g,b,a] of out){data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=a;}
}
// ===== VektorKu V2 Pro 1.46: warna kembar disatukan =====
// Warna yang di mata sama (beda di bawah ambang yang terlihat, diukur di OKLab) dijadikan satu kode warna, dan gradasi
// yang hentian warnanya praktis sama dijadikan warna rata. Bentuk tidak berubah sama sekali; hanya kode warnanya.
// Gunanya: "Select Same Fill" di Illustrator memilih semua bagian yang memang satu warna, berkas lebih sederhana.
function unifyOK(r,g,b){const f=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};const R=f(r),G=f(g),B=f(b);
 const l=Math.cbrt(.4122214708*R+.5363325363*G+.0514459929*B),m=Math.cbrt(.2119034982*R+.6806995451*G+.1073969566*B),s=Math.cbrt(.0883024619*R+.2817188376*G+.6299787005*B);
 return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];}
function unifyParse(c){let m=/^#([0-9a-f]{6})$/i.exec(c);if(m)return [0,1,2].map(i=>parseInt(m[1].slice(i*2,i*2+2),16));m=/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(c);return m?[+m[1],+m[2],+m[3]]:null;}
function unifyColors(svg,opt){
 opt=opt||{};const T=opt.tol??.012,MC=opt.maxChannel??12,TG=opt.gradTol??.012,dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
 // 1) gradasi yang praktis rata -> warna rata
 const flatGrad=new Map();
 svg=svg.replace(/<(linear|radial)Gradient\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1Gradient>/g,(all,t,id,body)=>{
  if(/stop-opacity/.test(body))return all;const cs=[...body.matchAll(/stop-color="([^"]+)"/g)].map(x=>unifyParse(x[1]));if(!cs.length||cs.some(c=>!c))return all;
  const ok=cs.map(c=>unifyOK(...c));let far=0;for(let i=0;i<ok.length;i++)for(let j=i+1;j<ok.length;j++)far=Math.max(far,dist(ok[i],ok[j]));
  if(far>TG)return all;const avg=[0,1,2].map(i=>Math.round(cs.reduce((a,c)=>a+c[i],0)/cs.length));flatGrad.set(id,`rgb(${avg[0]},${avg[1]},${avg[2]})`);return '';});
 if(flatGrad.size)svg=svg.replace(/fill="url\(#([^)]+)\)"/g,(m,id)=>flatGrad.has(id)?`fill="${flatGrad.get(id)}"`:m).replace(/<defs>\s*<\/defs>/,'');
 // 2) warna rata yang kembar -> satu kode; wakilnya warna dengan luas terbesar
 const area=new Map();
 for(const m of svg.matchAll(/<path\b[^>]*>/g)){const tag=m[0],f=/\bfill="([^"]+)"/.exec(tag),d=/\bd="([^"]+)"/.exec(tag);if(!f||!d||!unifyParse(f[1]))continue;
  const nums=d[1].match(/-?\d*\.?\d+(?:e-?\d+)?/gi)||[];let a=0;
  // luas kasar: rumus tali sepatu pada semua pasangan koordinat, per subpath (M baru)
  const parts=d[1].split(/(?=M)/);for(const part of parts){const v=(part.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)||[]).map(Number);let s=0;for(let i=0;i+3<v.length;i+=2)s+=v[i]*v[i+3]-v[i+2]*v[i+1];if(v.length>=4)s+=v[v.length-2]*v[1]-v[0]*v[v.length-1];a+=s/2;}
  area.set(f[1],(area.get(f[1])||0)+Math.abs(a)+nums.length);}
 const cols=[...area.entries()].sort((p,q)=>q[1]-p[1]).map(([c])=>({c,rgb:unifyParse(c)}));for(const x of cols)x.ok=unifyOK(...x.rgb);
 const rep=new Map(),heads=[];
 for(const x of cols){let h=null;for(const y of heads){const dark=x.ok[0]<(opt.darkL??.15)&&y.ok[0]<(opt.darkL??.15),dd=dist(x.ok,y.ok),mc=Math.max(...[0,1,2].map(i=>Math.abs(x.rgb[i]-y.rgb[i])));
  // hampir hitam: beda kecil tidak terlihat di warna segelap ini (garis tepi dasi kemerahan vs garis tepi hitam)
  if(dark?dd<=(opt.darkTol??.06)&&mc<=32:dd<=T&&mc<=MC){h=y;break;}}if(h){rep.set(x.c,h.c);}else heads.push(x);}
 if(!rep.size)return svg;
 return svg.replace(/\bfill="([^"]+)"/g,(m,c)=>rep.has(c)?`fill="${rep.get(c)}"`:m);
}
// Tutup setiap subpath dengan Z. Mesin menelusuri kontur tertutup tetapi menulisnya tanpa Z; di SVG isinya tetap
// benar, namun Illustrator membacanya sebagai path terbuka (ujung awal dan akhir hanya berimpit). Format yang dipakai
// Illustrator sendiri: ruas lurus terakhir yang kembali ke titik awal tidak ditulis, kurva terakhir yang berakhir di
// titik awal tetap ditulis, lalu Z.
function closePaths(svg){
 return svg.replace(/(<path\b[^>]*\sd=")([^"]+)(")/g,(all,a,d,b)=>{
  const parts=d.split(/(?=M)/);let changed=false;
  const out=parts.map(part=>{const t=part.trim();if(!t||/[Zz]$/.test(t))return part;
   const v=t.match(/-?\d*\.?\d+(?:e-?\d+)?/gi);if(!v||v.length<4)return part;const sx=+v[0],sy=+v[1],ex=+v[v.length-2],ey=+v[v.length-1];
   changed=true;const same=Math.abs(sx-ex)<1e-6&&Math.abs(sy-ey)<1e-6;
   if(same){const m=/L\s*(-?\d*\.?\d+)[\s,]+(-?\d*\.?\d+)\s*$/.exec(t);if(m&&t.slice(0,m.index).match(/[LC]/))return t.slice(0,m.index).trim()+'Z';}
   return t+'Z';});
  return changed?a+out.join('')+b:all;});
}
// Angka koordinat dibulatkan ke 1 desimal (0,1 satuan = paling banyak 0,1 piksel gambar asli, tidak terlihat), nol di
// belakang koma dibuang. Berkas SVG/EPS lebih kecil tanpa mengubah bentuk yang terlihat.
function shrinkNumbers(svg,dec){
 // gambar kecil yang diproses 2-3x lebih rapat tetap 2 desimal (hasilnya biasanya diperbesar banyak)
 if(dec==null){const t=(svg.match(/<svg\b[^>]*>/)||[''])[0],vb=((t.match(/viewBox="([^"]+)"/)||[])[1]||'').split(/[\s,]+/).map(Number),w=parseFloat((t.match(/\swidth="([\d.]+)/)||[])[1]);const hh=parseFloat((t.match(/\sheight="([\d.]+)/)||[])[1])||w;dec=vb[2]&&w&&vb[2]/w>1.2&&Math.max(w,hh)<=800?2:1;}
 const k=10**dec,f=s=>{const v=Math.round(parseFloat(s)*k)/k;return Object.is(v,-0)?'0':String(v);};
 return svg.replace(/(\sd=")([^"]+)(")/g,(all,a,d,b)=>a+d.replace(/-?\d*\.\d+(?:e-?\d+)?/gi,f)+b);
}
// ===== VektorKu V2 Pro 1.51: pemeriksa cacat =====
// Vektor digambar ulang lalu dibandingkan dengan gambar asli. Selisih yang cukup dijelaskan oleh geseran tepi 1 piksel
// (antialias, tepi sub-piksel) tidak dihitung; yang tersisa dikelompokkan menjadi area. Tiap area diberi jenis:
//  hilang   : gambar asli punya detail (kilau, titik, garis) yang tidak ada di vektor
//  berlebih : vektor punya bentuk yang tidak ada di gambar asli
//  warna    : bentuknya ada tetapi warnanya meleset
// S dan V: RGBA ukuran w x h (V = hasil vektor yang dirender pada ukuran yang sama).
function defectScan(S,V,w,h,opt){
 opt=opt||{};const N=w*h,T=opt.thr??64,R=opt.shift??1,lum=(B,p)=>.3*B[p*4]+.59*B[p*4+1]+.11*B[p*4+2];
 const comp=(B,p,c)=>{const a=B[p*4+3]/255;return B[p*4+c]*a+255*(1-a);};
 // selisih yang tahan geseran: piksel asli dibandingkan dengan piksel vektor terdekat yang paling mirip, dan sebaliknya
 const e=new Uint8Array(N);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;let d0=0;for(let c=0;c<3;c++){const a=Math.abs(comp(S,p,c)-comp(V,p,c));if(a>d0)d0=a;}if(d0<=T){e[p]=d0;continue;}let best=255,best2=255;
  for(let dy=-R;dy<=R;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;for(let dx=-R;dx<=R;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;const q=yy*w+xx;
   let d=0,d2=0;for(let c=0;c<3;c++){const a=Math.abs(comp(S,p,c)-comp(V,q,c)),b=Math.abs(comp(V,p,c)-comp(S,q,c));if(a>d)d=a;if(b>d2)d2=b;}
   if(d<best)best=d;if(d2<best2)best2=d2;}}
  e[p]=Math.min(255,Math.max(best,best2));}
 // kelompokkan piksel buruk (sambungan 8 arah, celah 1 piksel ikut tersambung)
 const bad=new Uint8Array(N);let any=0;for(let p=0;p<N;p++)if(e[p]>T){bad[p]=1;any++;}
 if(!any)return {areas:[],bad:0};
 const seen=new Int32Array(N).fill(-1),Q=new Int32Array(N),areas=[],Amin=opt.minArea??Math.max(6,Math.round(N*2e-6));
 for(let s0=0;s0<N;s0++){if(!bad[s0]||seen[s0]>=0)continue;const id=areas.length;let n=0,head=0;Q[n++]=s0;seen[s0]=id;
  let x0=w,y0=h,x1=0,y1=0,sum=0,dl=0,sx=0,sy=0,peak=0;
  while(head<n){const p=Q[head++],x=p%w,y=(p/w)|0;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);sum+=e[p];if(e[p]>peak)peak=e[p];sx+=x;sy+=y;dl+=lum(V,p)-lum(S,p);
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const q=yy*w+xx;if(bad[q]&&seen[q]<0){seen[q]=id;Q[n++]=q;}}}
  // tebal: piksel buruk yang tetangga 4-arahnya semua buruk; area yang hanya berupa garis setipis 1-2 piksel di sepanjang
  // tepi (geseran tepi lebih dari 1 piksel di bentuk besar) dihitung terpisah dan diberi bobot kecil
  let core=0;for(let i=0;i<n;i++){const p=Q[i],x=p%w,y=(p/w)|0;if(x&&x<w-1&&y&&y<h-1&&bad[p-1]&&bad[p+1]&&bad[p-w]&&bad[p+w])core++;}
  // struktur setempat: simpangan baku luminansi di kotak area, pada asli dan pada vektor
  const sd=B=>{let a=0,b=0,k=0;for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const L=lum(B,y*w+x);a+=L;b+=L*L;k++;}const m=a/k;return Math.sqrt(Math.max(0,b/k-m*m));};
  areas.push({x0,y0,x1,y1,cx:sx/n,cy:sy/n,n,core,peak,score:sum,dl:dl/n,sdS:0,sdV:0,_sd:sd});}
 const out=[];
 // diterima: area yang cukup besar, atau titik kecil yang sangat kontras (kilau mata yang hilang)
 for(const a of areas){if(!((a.n>=Amin&&a.core>=(opt.minCore??2))||(a.n>=(opt.minDot??3)&&a.peak>=(opt.dotPeak??140))))continue;a.sdS=a._sd(S);a.sdV=a._sd(V);delete a._sd;
  a.type=a.sdS>a.sdV*1.35+4?'hilang':a.sdV>a.sdS*1.35+4?'berlebih':'warna';out.push(a);}
 out.sort((a,b)=>b.score-a.score);
 return {areas:out.slice(0,opt.max??40),bad:any,e};
}
// ===== VektorKu V2 Pro 1.51: perbaikan otomatis per area =====
// Setelah vektor jadi, hasilnya digambar ulang (OffscreenCanvas di worker) dan dipindai dengan defectScan. Untuk tiap
// area cacat, piksel yang meleset dikelompokkan menurut warna aslinya; tiap kelompok dibentuk ulang dari gambar asli
// pada kisi 4x lebih rapat (anggota = piksel yang warnanya lebih dekat ke warna kelompok daripada ke warna vektor di
// situ), ditelusuri dengan Potrace, lalu ditempel di atas vektor sebagai bentuk berwarna rata. Tambalan disimpan hanya
// bila hasil gambar ulang di area itu memang lebih mirip aslinya. Area yang tetap meleset dilaporkan untuk penanda.

// Menggambar SVG hasil VektorKu V2 Pro (path, fill rgb/url, gradasi linear/radial userSpaceOnUse, evenodd) ke RGBA w x h.
function svgRaster(svg,w,h){
 if(typeof OffscreenCanvas==='undefined'||typeof Path2D==='undefined')return null;
 const cv=new OffscreenCanvas(w,h),g=cv.getContext('2d');if(!g)return null;
 const root=(svg.match(/<svg\b[^>]*>/)||[''])[0],vb=((root.match(/viewBox="([^"]+)"/)||[])[1]||'').split(/[\s,]+/).map(Number);
 const vw=vb[2]||w,vh=vb[3]||h;g.fillStyle='#fff';g.fillRect(0,0,w,h);g.setTransform(w/vw,0,0,h/vh,-(vb[0]||0)*w/vw,-(vb[1]||0)*h/vh);
 const grads=new Map();
 for(const m of svg.matchAll(/<(linear|radial)Gradient\b([^>]*)>([\s\S]*?)<\/\1Gradient>/g)){const at=m[2],num=k=>parseFloat((at.match(new RegExp('\\s'+k+'="([^"]+)"'))||[])[1]),id=(at.match(/\sid="([^"]+)"/)||[])[1];if(!id)continue;
  let gr;if(m[1]==='linear')gr=g.createLinearGradient(num('x1')||0,num('y1')||0,num('x2')||0,num('y2')||0);else{const cx=num('cx')||0,cy=num('cy')||0,r=num('r')||1,fx=num('fx'),fy=num('fy');gr=g.createRadialGradient(isNaN(fx)?cx:fx,isNaN(fy)?cy:fy,0,cx,cy,r);}
  for(const st of m[3].matchAll(/<stop\b([^>]*)>/g)){const o=parseFloat((st[1].match(/offset="([^"]+)"/)||[])[1])||0,c=(st[1].match(/stop-color="([^"]+)"/)||[])[1]||'#000',op=(st[1].match(/stop-opacity="([^"]+)"/)||[])[1];
   let col=c;if(op!==undefined){const k=/rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c);if(k)col=`rgba(${k[1]},${k[2]},${k[3]},${op})`;}try{gr.addColorStop(Math.max(0,Math.min(1,o)),col);}catch(e){}}
  grads.set(id,gr);}
 for(const m of svg.matchAll(/<path\b([^>]*)>/g)){const at=m[1],d=(at.match(/\sd="([^"]*)"/)||[])[1],f=(at.match(/\sfill="([^"]*)"/)||[])[1];if(!d||!f||f==='none')continue;
  const u=/^url\(#([^)]+)\)$/.exec(f);g.fillStyle=u?(grads.get(u[1])||'#888'):f;const op=(at.match(/\sopacity="([^"]*)"/)||[])[1];g.globalAlpha=op?+op:1;
  try{g.fill(new Path2D(d),/evenodd/.test(at)?'evenodd':'nonzero');}catch(e){}}
 g.globalAlpha=1;return g.getImageData(0,0,w,h).data;
}

function selfRepair(svg,S,w,h,opt){
 opt=opt||{};const raster=opt.raster||svgRaster;let V=raster(svg,w,h);if(!V)return null;
 const scan=defectScan(S,V,w,h,opt.scan||{});if(!scan.areas.length)return {svg,areas:[],fixed:0,tried:0};
 const root=(svg.match(/<svg\b[^>]*>/)||[''])[0],vb=((root.match(/viewBox="([^"]+)"/)||[])[1]||'').split(/[\s,]+/).map(Number),sx=(vb[2]||w)/w,sy=(vb[3]||h)/h;
 const K=opt.fine??4,T=(opt.scan&&opt.scan.thr)??64,pad=3,col=(B,p,c)=>{const a=B[p*4+3]/255;return B[p*4+c]*a+255*(1-a);};
 const patches=[];let tried=0;
 for(const a of scan.areas.slice(0,opt.maxAreas??30)){
  const x0=Math.max(0,a.x0-pad),y0=Math.max(0,a.y0-pad),x1=Math.min(w-1,a.x1+pad),y1=Math.min(h-1,a.y1+pad);
  // kelompok warna dari piksel yang meleset: piksel paling meleset lebih dulu, warnanya jadi warna kelompok; piksel lain
  // (termasuk campuran antialias di pinggir detail itu) ikut kelompok terdekat dalam jarak 60. Kelompok yang warnanya
  // hanya campuran warna kelompok lain dengan warna vektor dibuang (itu pinggiran, bukan detail tersendiri).
  const px=[];for(let y=a.y0;y<=a.y1;y++)for(let x=a.x0;x<=a.x1;x++){const p=y*w+x;if(scan.e[p]>T)px.push(p);}px.sort((p,q)=>scan.e[q]-scan.e[p]);
  const groups=[];
  for(const p of px){const c=[col(S,p,0),col(S,p,1),col(S,p,2)];let gI=-1,best=60*60;for(let i=0;i<groups.length;i++){const q=groups[i],dd=(q.c[0]-c[0])**2+(q.c[1]-c[1])**2+(q.c[2]-c[2])**2;if(dd<best){best=dd;gI=i;}}
   if(gI<0){if(groups.length>=3)continue;const v=[col(V,p,0),col(V,p,1),col(V,p,2)];
    let mix=false;for(const q of groups){const d0=[q.c[0]-v[0],q.c[1]-v[1],q.c[2]-v[2]],u=[c[0]-v[0],c[1]-v[1],c[2]-v[2]],g2=d0[0]**2+d0[1]**2+d0[2]**2;if(g2<1)continue;const t=(u[0]*d0[0]+u[1]*d0[1]+u[2]*d0[2])/g2,r=(u[0]-t*d0[0])**2+(u[1]-t*d0[1])**2+(u[2]-t*d0[2])**2;if(t>.05&&t<.95&&r<30*30){mix=true;break;}}
    if(mix)continue;groups.push({c,n:0,s:[0,0,0]});gI=groups.length-1;}const G=groups[gI];G.n++;G.s[0]+=c[0];G.s[1]+=c[1];G.s[2]+=c[2];}
  for(const G of groups)if(G.n)G.c=G.s.map(v=>v/G.n);
  for(const q of groups){if(q.n<2)continue;tried++;const gc=q.c;
   // kisi rapat: anggota bila warna asli (bilinear) lebih dekat ke warna kelompok daripada warna vektor di titik itu
   const bw=(x1-x0+1)*K,bh=(y1-y0+1)*K,bm=new PotraceBrowser.Bitmap(bw,bh);let on=0;
   const smp=(B,fx,fy,c)=>{fx=Math.max(0,Math.min(w-1.001,fx));fy=Math.max(0,Math.min(h-1.001,fy));const ix=fx|0,iy=fy|0,ax=fx-ix,ay=fy-iy,p=iy*w+ix;
    return (col(B,p,c)*(1-ax)+col(B,p+1,c)*ax)*(1-ay)+(col(B,p+w,c)*(1-ax)+col(B,p+w+1,c)*ax)*ay;};
   for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){const fx=x0+(x+.5)/K-.5,fy=y0+(y+.5)/K-.5;let ds=0,dv=0;
    for(let c=0;c<3;c++){const s=smp(S,fx,fy,c),v=smp(V,fx,fy,c);ds+=(s-gc[c])**2;dv+=(s-v)**2;}
    const inside=ds<dv*(opt.memberBias??1.6)&&ds<(opt.memberTol??64)**2;bm.data[y*bw+x]=inside?0:255;if(inside)on++;}
   if(on<K*K)continue;
   // pita tipis di sepanjang tepi yang sudah ada tidak ditambal (justru jadi lis/halo); yang ditambal: bercak yang cukup
   // tebal, atau titik kecil yang padat (kilau mata). Tebal = jarak terjauh ke luar bercak, dalam piksel gambar asli.
   {const M=bw*bh,dt=new Float32Array(M);for(let i=0;i<M;i++)dt[i]=bm.data[i]===0?1e4:0;
    for(let y=0;y<bh;y++)for(let x=0;x<bw;x++){const i=y*bw+x;if(!dt[i])continue;let v=dt[i];if(x&&dt[i-1]+1<v)v=dt[i-1]+1;else if(!x)v=Math.min(v,1);if(y&&dt[i-bw]+1<v)v=dt[i-bw]+1;else if(!y)v=Math.min(v,1);dt[i]=v;}
    for(let y=bh-1;y>=0;y--)for(let x=bw-1;x>=0;x--){const i=y*bw+x;if(!dt[i])continue;let v=dt[i];if(x<bw-1&&dt[i+1]+1<v)v=dt[i+1]+1;else if(x===bw-1)v=Math.min(v,1);if(y<bh-1&&dt[i+bw]+1<v)v=dt[i+bw]+1;else if(y===bh-1)v=Math.min(v,1);dt[i]=v;}
    const lab=new Int32Array(M).fill(-1),st=[];let kept=0;
    for(let i0=0;i0<M;i0++){if(bm.data[i0]!==0||lab[i0]>=0)continue;const id=i0;st.length=0;st.push(i0);lab[i0]=id;const mem=[];let tmax=0;
     while(st.length){const i=st.pop();mem.push(i);if(dt[i]>tmax)tmax=dt[i];const x=i%bw,y=(i/bw)|0;for(const j of [x?i-1:-1,x<bw-1?i+1:-1,y?i-bw:-1,y<bh-1?i+bw:-1])if(j>=0&&bm.data[j]===0&&lab[j]<0){lab[j]=id;st.push(j);}}
     const t=tmax/K,el=mem.length/(K*K)/Math.max(.25,t*t);
     // tambalan yang menempel di sepanjang tepi vektor yang sudah ada (lis di pinggir bentuk) tidak dipakai
     let per=0,hug=0;for(const i of mem){const x=i%bw,y=(i/bw)|0;if(x&&x<bw-1&&y&&y<bh-1&&bm.data[i-1]===0&&bm.data[i+1]===0&&bm.data[i-bw]===0&&bm.data[i+bw]===0)continue;per++;
      const fx=x0+(x+.5)/K-.5,fy=y0+(y+.5)/K-.5;let near=false;for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]){let dd=0;for(let c=0;c<3;c++)dd=Math.max(dd,Math.abs(smp(V,fx+ox,fy+oy,c)-smp(V,fx-ox,fy-oy,c)));if(dd>(opt.edgeV??60)){near=true;break;}}if(near)hug++;}
     const ok=hug<=(opt.maxHug??.45)*per&&(t>=(opt.minThick??1.25)||(t>=(opt.dotThick??.4)&&el<=(opt.dotElong??14)&&mem.length>=K*K&&hug<=.25*per));
     if(!ok)for(const i of mem)bm.data[i]=255;else kept+=mem.length;}
    if(kept<K*K)continue;}
   const tr=new PotraceBrowser.Potrace({threshold:128,turdSize:K*K*.8,alphaMax:1,optCurve:true,optTolerance:.2*K});tr._luminanceData=bm;tr._imageLoaded=true;tr._bmToPathlist();tr._processPath();tr._processed=true;
   if(!tr._pathlist.length)continue;const done=new Set();
   for(const path of tr._pathlist)for(const p of path.curve.c){if(p&&!done.has(p)){done.add(p);p.x=(x0+p.x/K)*sx;p.y=(y0+p.y/K)*sy;}}
   const tag=tr.getPathTag('black'),d=(tag.match(/d="([^"]*)"/)||[])[1];if(!d)continue;
   patches.push({area:a,box:[x0,y0,x1,y1],path:`<path d="${d}" stroke="none" fill="rgb(${gc.map(Math.round).join(',')})" fill-rule="evenodd"/>`});}}
 if(!patches.length)return {svg,areas:scan.areas,fixed:0,tried};
 // simpan tambalan per area hanya bila areanya membaik
 const err=(B,b)=>{let t=0;for(let y=b[1];y<=b[3];y++)for(let x=b[0];x<=b[2];x++){const p=y*w+x;let m=0;for(let c=0;c<3;c++){const d=Math.abs(col(S,p,c)-col(B,p,c));if(d>m)m=d;}t+=m;}return t;};
 const all=svg.replace(/<\/svg>\s*$/,patches.map(p=>p.path).join('')+'</svg>'),V2=raster(all,w,h);if(!V2)return {svg,areas:scan.areas,fixed:0,tried};
 const keep=patches.filter(p=>err(V2,p.box)<err(V,p.box)*(opt.gain??.85));
 if(!keep.length)return {svg,areas:scan.areas,fixed:0,tried};
 const out=svg.replace(/<\/svg>\s*$/,keep.map(p=>p.path).join('')+'</svg>'),V3=raster(out,w,h),after=defectScan(S,V3,w,h,opt.scan||{});
 const fixedAreas=new Set(keep.map(p=>p.area));
 return {svg:out,areas:after.areas,fixed:fixedAreas.size,tried,before:scan.areas.length};
}
let backgroundRemovalNote='',rawPixels=null,lastNoisy=false;const __postRaw=x=>postMessage(x);

self.onmessage=({data:m})=>{detailKeep=null;stackTrace.ink=!!(m.settings&&m.settings.ink===true);const postMessage=x=>{if(x&&typeof x.svg==='string'&&m.settings&&m.settings.repair!==false&&rawPixels&&rawPixels.length===m.width*m.height*4&&x.engine!=='Pixel art'){try{__postRaw({phase:'Memeriksa dan memperbaiki cacat…',stage:4});const t0=Date.now(),r=selfRepair(x.svg,rawPixels,m.width,m.height,m.settings.repairOpt||{});if(r)x=Object.assign({},x,{svg:r.svg,defects:{areas:r.areas.slice(0,10).map(a=>({x0:a.x0,y0:a.y0,x1:a.x1,y1:a.y1,type:a.type})),total:r.areas.length,fixed:r.fixed,before:r.before??r.areas.length,w:m.width,h:m.height,ms:Date.now()-t0}});}catch(e){}}if(x&&typeof x.svg==='string'&&m.settings&&m.settings.unify!==false){try{x=Object.assign({},x,{svg:m.settings.shrink===false?closePaths(unifyColors(x.svg)):shrinkNumbers(closePaths(unifyColors(x.svg)))});}catch(e){}}__postRaw(x);};try{
 backgroundRemovalNote="";postMessage({phase:"Menganalisis gambar…",stage:1});
 const {width:w,height:h,settings:s}=m;let automaticColor=s.mode==='auto';let d=new Uint8ClampedArray(m.buffer);let transparent=false;if(s.removeBackground){postMessage({phase:"Menghapus latar dari tepi…",stage:1});const bg=removeOuterBackground(d,w,h);d=bg.data;backgroundRemovalNote=bg.note;s.removeWhite=false;}colorTraceSource={data:d.slice(),width:w,height:h,pal:[]};
 // Persiapan gambar. Otomatis: ilustrasi selalu difilter jaga-tepi (seperti sebelumnya); logo berwarna
 // hanya bila ada artefak kompresi; logo satu warna tidak difilter (tepinya diukur dengan luas cakupan,
 // yang sudah merata-ratakan derau). Pilihan eksplisit berlaku untuk semua jalur.
 const pre=s.denoise===false?'none':(s.preprocess||'auto'),filtered={},prepare=mode=>mode==='none'?d:(filtered[mode]||(filtered[mode]=preprocessPixels(d,w,h,mode)));
 if(s.detail===false){s.recolor=false;s.gradients=false;s.split=false;}
 s.sourceNoisy=s.mode!=='texture'&&compressionNoise(d,w,h)>.25;lastNoisy=!!s.sourceNoisy;rawPixels=d;s.sizeFactor=Math.max(1,(Math.max(w,h)/700)**2);
 if(s.pixel!==false&&(s.mode==='auto'||s.mode==='pixel')){
  if(s.mode==='pixel')postMessage({phase:'Mencari grid pixel art…'});
  let px=null;try{px=pixelArt(d,w,h,s,m.originalWidth,m.originalHeight,s.mode==='pixel');}catch(e){px=null;}if(px){postMessage(px);return;}
  if(s.mode==='pixel'){s.mode='auto';automaticColor=true;backgroundRemovalNote+=' Grid pixel art tidak ditemukan, jadi gambar diproses seperti biasa.';}}
 if(s.mode==='texture'){postMessage(textureCandidate(d,w,h,s,m.originalWidth,m.originalHeight));return;}
 if(s.mode==='auto'&&s.twoTone!==false){let share=0;try{share=twoToneShare(d,w,h);}catch(e){}
  if(share>=(s.twoToneMin??.985)){const r=monoCandidate(prepare(pre==='auto'?'none':pre),w,h,{...s,mode:'mono',twoTone:true},m.originalWidth,m.originalHeight);if(r){r.engine='Dua warna';postMessage(r);return;}}}
 if(['auto','logoColor','logo'].includes(s.mode)){let logo=colorLogoCandidate(prepare(pre==='auto'?(s.sourceNoisy?'edge':'none'):pre),w,h,s,m.originalWidth,m.originalHeight);
  // gambar kecil yang ditolak mesin warna dengan interpolasi kubik dicoba sekali lagi dengan interpolasi linear
  if(!logo&&s.cubic!==false&&(Math.max(w,h)<=768||(s.up2!==false&&Math.max(w,h)<=1600&&w*h<=1.25e6))){s.cubic=false;try{logo=colorLogoCandidate(prepare(pre==='auto'?(s.sourceNoisy?'edge':'none'):pre),w,h,s,m.originalWidth,m.originalHeight);}finally{delete s.cubic;}}
  if(logo){postMessage(logo);return;}}
 if(['auto','mono','bw','logo'].includes(s.mode)){const result=monoCandidate(prepare(pre==='auto'?'none':pre),w,h,s.mode==='logo'?{...s,mode:'mono'}:s,m.originalWidth,m.originalHeight);if(result){postMessage(result);return;}s.mode='color';} d=prepare(pre==='auto'?'edge':pre);if(d===rawPixels)d=d.slice();
 postMessage({phase:'Memisahkan warna dan transparansi…'});
 for(let i=0;i<d.length;i+=4){if(d[i+3]<128||(s.removeWhite&&d[i]>=s.whiteLevel&&d[i+1]>=s.whiteLevel&&d[i+2]>=s.whiteLevel)){d[i]=d[i+1]=d[i+2]=d[i+3]=0;transparent=true}else{d[i+3]=255;if(s.mode==='bw'){let v=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2]>=s.threshold?255:0;d[i]=d[i+1]=d[i+2]=v}}}
 let pal=s.mode==='bw'?[{r:0,g:0,b:0,a:255},{r:255,g:255,b:255,a:255}]:automaticColor?automaticPalette(d,s.clean?8+s.clean*3:0):paletteFor(d,s.colors,s.clean?8+s.clean*3:0);
 if(!pal.length)throw Error('Tidak ada area terlihat. Matikan penghapus putih atau pilih gambar lain.');
 // Snap opaque pixels to the opaque palette first, preserving transparent pixels exactly.
 const cache=new Map();for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;const key=(d[i]<<16)|(d[i+1]<<8)|d[i+2];let k=cache.get(key);if(k===undefined){let dd=Infinity;k=0;for(let j=0;j<pal.length;j++){const p=pal[j],v=(d[i]-p.r)**2+(d[i+1]-p.g)**2+(d[i+2]-p.b)**2;if(v<dd){dd=v;k=j}}cache.set(key,k)}d[i]=pal[k].r;d[i+1]=pal[k].g;d[i+2]=pal[k].b}
 if(transparent)pal.push({r:0,g:0,b:0,a:0});
 postMessage({phase:'Menelusuri bentuk dan merapikan kurva…'});
 
 let svg=smoothSVG({width:w,height:h,data:d},pal,s,m.originalWidth,m.originalHeight);
 postMessage({svg,engine:'Ilustrasi'});
 }catch(e){postMessage({error:e.message||'Gagal memproses gambar.'})}};
