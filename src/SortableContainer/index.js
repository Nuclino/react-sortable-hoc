import React, {Component} from 'react';
import PropTypes from 'prop-types';
import {findDOMNode} from 'react-dom';
import invariant from 'invariant';

import Manager from '../Manager';
import {
  closest,
  events,
  limit,
  getElementMargin,
  provideDisplayName,
  omit,
} from '../utils';

// Export Higher Order Sortable Container Component
export default function sortableContainer(WrappedComponent, config = {withRef: false}) {
  return class extends Component {
    constructor(props) {
      super(props);
      this.manager = new Manager();
      this.events = {
        start: this.handleStart,
        move: this.handleMove,
        end: this.handleEnd,
      };

      invariant(
        !(props.distance && props.pressDelay),
        'Attempted to set both `pressDelay` and `distance` on SortableContainer, you may only use one or the other, not both at the same time.'
      );

      this.state = {};
    }

    static displayName = provideDisplayName('sortableList', WrappedComponent);

    static defaultProps = {
      axis: 'y',
      transitionDuration: 300,
      pressDelay: 0,
      pressThreshold: 5,
      distance: 0,
      useCustomEvents: false,
      useWindowAsScrollContainer: false,
      hideSortableGhost: true,
      shouldCancelStart: function(e) {
        // Cancel sorting if the event target is an `input`, `textarea`, `select` or `option`
        const disabledElements = ['input', 'textarea', 'select', 'option', 'button'];

        if (disabledElements.indexOf(e.target.tagName.toLowerCase()) !== -1) {
          return true; // Return true to cancel sorting
        }
      },
      lockToContainerEdges: false,
      lockOffset: '50%',
      getHelperDimensions: ({node}) => ({
        width: node.offsetWidth,
        height: node.offsetHeight,
      }),
    };

    static propTypes = {
      axis: PropTypes.oneOf(['x', 'y', 'xy']),
      distance: PropTypes.number,
      lockAxis: PropTypes.string,
      helperClass: PropTypes.string,
      transitionDuration: PropTypes.number,
      contentWindow: PropTypes.any,
      onSortStart: PropTypes.func,
      onSortMove: PropTypes.func,
      onSortHover: PropTypes.func,
      onSortEnd: PropTypes.func,
      canSortDrop: PropTypes.func,
      shouldCancelStart: PropTypes.func,
      pressDelay: PropTypes.number,
      useDragHandle: PropTypes.bool,
      useCustomEvents: PropTypes.bool,
      useWindowAsScrollContainer: PropTypes.bool,
      hideSortableGhost: PropTypes.bool,
      lockToContainerEdges: PropTypes.bool,
      lockOffset: PropTypes.oneOfType([
        PropTypes.number,
        PropTypes.string,
        PropTypes.arrayOf(
          PropTypes.oneOfType([PropTypes.number, PropTypes.string])
        ),
      ]),
      getContainer: PropTypes.func,
      getHelperDimensions: PropTypes.func,
    };

    static childContextTypes = {
      manager: PropTypes.object.isRequired,
    };

    getChildContext() {
      return {
        manager: this.manager,
      };
    }

    componentDidMount() {
      const {
        getContainer,
        useWindowAsScrollContainer,
      } = this.props;

      /*
       *  Set our own default rather than using defaultProps because Jest
       *  snapshots will serialize window, causing a RangeError
       *  https://github.com/clauderic/react-sortable-hoc/issues/249
       */
      const contentWindow = this.props.contentWindow || window;

      this.container = typeof getContainer === 'function'
        ? getContainer(this.getWrappedInstance())
        : findDOMNode(this);
      this.document = this.container.ownerDocument || document;
      this.scrollContainer = useWindowAsScrollContainer
        ? this.document.body
        : this.container;
      this.contentWindow = typeof contentWindow === 'function'
        ? contentWindow()
        : contentWindow;

      for (const key in this.events) {
        if (this.events.hasOwnProperty(key)) {
          events[key].forEach(eventName =>
            this.container.addEventListener(eventName, this.events[key], false)
          );
        }
      }
    }

    componentWillUnmount() {
      for (const key in this.events) {
        if (this.events.hasOwnProperty(key)) {
          events[key].forEach(eventName =>
            this.container.removeEventListener(eventName, this.events[key])
          );
        }
      }
    }

    handleStart = e => {
      const {distance, shouldCancelStart} = this.props;

      if (e.button === 2 || shouldCancelStart(e)) {
        return false;
      }

      this._touched = true;
      this._pos = {
        x: e.changedTouches ? e.changedTouches[0].pageX : e.pageX,
        y: e.changedTouches ? e.changedTouches[0].pageY : e.pageY,
      };

      const node = closest(e.target, el => el.sortableInfo != null);

      if (
        node &&
        node.sortableInfo &&
        this.nodeIsChild(node) &&
        !this.state.sorting
      ) {
        const {useDragHandle} = this.props;
        const {index, collection} = node.sortableInfo;

        if (
          useDragHandle && !closest(e.target, el => el.sortableHandle != null)
        )
          return;

        this.manager.active = {index, collection};

        /*
         * Fixes a bug in Firefox where the :active state of anchor tags
         * prevent subsequent 'mousemove' events from being fired
         * (see https://github.com/clauderic/react-sortable-hoc/issues/118)
         */
        if (e.target.tagName.toLowerCase() === 'a') {
          e.preventDefault();
        }

        if (!distance) {
          if (this.props.pressDelay === 0) {
            this.handlePress(e);
          } else {
            this.pressTimer = setTimeout(
              () => this.handlePress(e),
              this.props.pressDelay
            );
          }
        }
      }
    };

    nodeIsChild = node => {
      return node.sortableInfo.manager === this.manager;
    };

    handleMove = e => {
      const {distance, pressThreshold} = this.props;

      if (!this.state.sorting && this._touched) {
        this._delta = {
          x: this._pos.x - (e.changedTouches ? e.changedTouches[0].pageX : e.pageX),
          y: this._pos.y - (e.changedTouches ? e.changedTouches[0].pageY : e.pageY),
        };
        const delta = Math.abs(this._delta.x) + Math.abs(this._delta.y);

        if (!distance && (!pressThreshold || pressThreshold && delta >= pressThreshold)) {
          clearTimeout(this.cancelTimer);
          this.cancelTimer = setTimeout(this.cancel, 0);
        } else if (distance && delta >= distance && this.manager.isActive()) {
          this.handlePress(e);
        }
      }
    };

    handleEnd = () => {
      const {distance} = this.props;

      this._touched = false;

      if (!distance) {
        this.cancel();
      }
      else if (!this.state.sorting) {
        this.manager.active = null;
      }
    };

    cancel = () => {
      if (!this.state.sorting) {
        clearTimeout(this.pressTimer);
        this.manager.active = null;
      }
    };

    // If an origin is given, no helper is created and onSortStart does not get called.
    // This is useful when the drag starts in another container and this container should
    // be set up to be able to handle move events.
    handlePress = (e, origin) => {
      const isOrigin = typeof origin === 'undefined';
      let node;
      if (isOrigin) {
        const active = this.manager.getActive();
        node = active && active.node;
      }
      else {
        node = origin.node;
        // Make the default collection active (normally set by handleStart)
        this.manager.active = {index: null, collection: 0};
      }

      if (node) {
        const {
          axis,
          getHelperDimensions,
          helperClass,
          hideSortableGhost,
          onSortStart,
          useCustomEvents,
          useWindowAsScrollContainer,
        } = this.props;
        const {index, collection} = this.manager.active;
        const margin = getElementMargin(node);

        const containerBoundingRect = this.container.getBoundingClientRect();
        const dimensions = getHelperDimensions({index, node, collection});

        this.node = node;
        this.margin = margin;
        this.width = dimensions.width;
        this.height = dimensions.height;
        this.marginOffset = {
          x: this.margin.left + this.margin.right,
          y: Math.max(this.margin.top, this.margin.bottom),
        };
        this.boundingClientRect = node.getBoundingClientRect();
        this.containerBoundingRect = containerBoundingRect;
        this.index = index;
        this.newIndex = index;

        this.axis = {
          x: axis.indexOf('x') >= 0,
          y: axis.indexOf('y') >= 0,
        };
        this.offsetEdge = {
          top: this.boundingClientRect.top - this.containerBoundingRect.top + this.container.scrollTop,
          left: this.boundingClientRect.left - this.containerBoundingRect.left + this.container.scrollLeft,
        };
        this.initialOffset = this.getOffset(e);
        this.initialScroll = {
          top: this.scrollContainer.scrollTop,
          left: this.scrollContainer.scrollLeft,
        };

        this.initialWindowScroll = {
          top: window.pageYOffset,
          left: window.pageXOffset,
        };

        // Only create the helper node if the press originates from this container
        if (isOrigin) {
          const fields = node.querySelectorAll('input, textarea, select');
          const clonedNode = node.cloneNode(true);
          const clonedFields = [
            ...clonedNode.querySelectorAll('input, textarea, select'),
          ]; // Convert NodeList to Array

          clonedFields.forEach((field, index) => {
            if (field.type !== 'file' && fields[index]) {
              field.value = fields[index].value;
            }
          });

          this.helper = this.document.body.appendChild(clonedNode);

          this.helper.style.position = 'fixed';
          this.helper.style.top = `${this.boundingClientRect.top - margin.top}px`;
          this.helper.style.left = `${this.boundingClientRect.left - margin.left}px`;
          this.helper.style.width = `${this.width}px`;
          this.helper.style.height = `${this.height}px`;
          this.helper.style.boxSizing = 'border-box';
          this.helper.style.pointerEvents = 'none';

          if (helperClass) {
            this.helper.classList.add(...helperClass.split(' '));
          }

          if (hideSortableGhost) {
            this.sortableGhost = node;
            node.style.visibility = 'hidden';
            node.style.opacity = 0;
          }
        }

        this.minTranslate = {};
        this.maxTranslate = {};
        if (this.axis.x) {
          this.minTranslate.x = (useWindowAsScrollContainer
            ? 0
            : containerBoundingRect.left) -
            this.boundingClientRect.left -
            this.width / 2;
          this.maxTranslate.x = (useWindowAsScrollContainer
            ? this.contentWindow.innerWidth
            : containerBoundingRect.left + containerBoundingRect.width) -
            this.boundingClientRect.left -
            this.width / 2;
        }
        if (this.axis.y) {
          this.minTranslate.y = (useWindowAsScrollContainer
            ? 0
            : containerBoundingRect.top) -
            this.boundingClientRect.top -
            this.height / 2;
          this.maxTranslate.y = (useWindowAsScrollContainer
            ? this.contentWindow.innerHeight
            : containerBoundingRect.top + containerBoundingRect.height) -
            this.boundingClientRect.top -
            this.height / 2;
        }

        if (isOrigin && !useCustomEvents) {
          this.listenerNode = e.touches ? node : this.contentWindow;
          events.move.forEach(eventName =>
            this.listenerNode.addEventListener(
              eventName,
              this.handleSortMove,
              false
            ));
          events.end.forEach(eventName =>
            this.listenerNode.addEventListener(
              eventName,
              this.handleSortEnd,
              false
            ));
        }

        this.setState({
          isOrigin,
          sorting: true,
        });

        // Only call onSortStart from the origin
        if (onSortStart && isOrigin) onSortStart({node, index, collection}, e);
      }
    };

    handleSortMove = e => {
      if (this._paused)
        this._paused = false;

      const {onSortMove} = this.props;
      e.preventDefault(); // Prevent scrolling on mobile

      this.updatePosition(e);
      this.animateNodes();
      this.autoscroll();

      if (onSortMove) onSortMove(e);
    };

    pauseSortMove = () => {
      // Stop autoscroll
      if (this.autoscrollInterval) {
        clearInterval(this.autoscrollInterval);
        this.autoscrollInterval = null;
        this.isAutoScrolling = false;
      }

      if (this._paused || !this.manager.active)
        return;

      const {collection} = this.manager.active;
      const nodes = this.manager.refs[collection];
      if (nodes) {
        this._paused = true;
        for (let i = 0, len = nodes.length; i < len; i++) {
          const node = nodes[i];
          const el = node.node;

          // Clear the cached offsetTop / offsetLeft value
          node.edgeOffset = null;
          el.sortableInfo.translate = {x: 0, y: 0};

          // Reset the transforms
          el.style['Transform'] = 'translate3d(0,0,0)';
        }
      }
    };

    handleSortEnd = e => {
      const {hideSortableGhost, onSortEnd} = this.props;
      const {collection} = this.manager.active;

      // Remove the event listeners if the node is still in the DOM
      if (this.listenerNode) {
        events.move.forEach(eventName =>
          this.listenerNode.removeEventListener(
            eventName,
            this.handleSortMove
          ));
        events.end.forEach(eventName =>
          this.listenerNode.removeEventListener(eventName, this.handleSortEnd));
      }

      // Remove the helper from the DOM
      if (this.helper) {
        this.helper.parentNode.removeChild(this.helper);
        this.helper = null;

        if (hideSortableGhost && this.sortableGhost) {
          this.sortableGhost.style.visibility = '';
          this.sortableGhost.style.opacity = '';
          this.sortableGhost = null;
        }
      }

      const nodes = this.manager.refs[collection];
      if (nodes) {
        for (let i = 0, len = nodes.length; i < len; i++) {
          const node = nodes[i];
          const el = node.node;

          // Clear the cached offsetTop / offsetLeft value
          node.edgeOffset = null;
          el.sortableInfo.translate = {x: 0, y: 0};

          // Remove the transforms / transitions
          el.style['Transform'] = '';
          el.style['TransitionDuration'] = '';
        }
      }

      // Stop autoscroll
      clearInterval(this.autoscrollInterval);
      this.autoscrollInterval = null;

      // Update state
      this.manager.active = null;

      this.setState({
        isOrigin: false,
        sorting: false,
      });

      if (typeof onSortEnd === 'function') {
        onSortEnd(
          {
            oldIndex: this.index,
            newIndex: this.newIndex,
            collection,
          },
          e
        );
      }

      this._paused = false;
      this._touched = false;
    };

    getEdgeOffset(node, offset = {top: 0, left: 0}) {
      // Get the actual offsetTop / offsetLeft value, no matter how deep the node is nested
      if (node) {
        const nodeOffset = {
          top: offset.top + node.offsetTop,
          left: offset.left + node.offsetLeft,
        };
        if (node.parentNode !== this.container) {
          return this.getEdgeOffset(node.parentNode, nodeOffset);
        } else {
          return nodeOffset;
        }
      }
    }

    getOffset(e) {
      return {
        x: e.touches ? e.touches[0].pageX : e.pageX,
        y: e.touches ? e.touches[0].pageY : e.pageY,
      };
    }

    getLockPixelOffsets() {
      let {lockOffset} = this.props;

      if (!Array.isArray(lockOffset)) {
        lockOffset = [lockOffset, lockOffset];
      }

      invariant(
        lockOffset.length === 2,
        'lockOffset prop of SortableContainer should be a single ' +
          'value or an array of exactly two values. Given %s',
        lockOffset
      );

      const [minLockOffset, maxLockOffset] = lockOffset;

      return [
        this.getLockPixelOffset(minLockOffset),
        this.getLockPixelOffset(maxLockOffset),
      ];
    }

    getLockPixelOffset(lockOffset) {
      let offsetX = lockOffset;
      let offsetY = lockOffset;
      let unit = 'px';

      if (typeof lockOffset === 'string') {
        const match = /^[+-]?\d*(?:\.\d*)?(px|%)$/.exec(lockOffset);

        invariant(
          match !== null,
          'lockOffset value should be a number or a string of a ' +
            'number followed by "px" or "%". Given %s',
          lockOffset
        );

        offsetX = (offsetY = parseFloat(lockOffset));
        unit = match[1];
      }

      invariant(
        isFinite(offsetX) && isFinite(offsetY),
        'lockOffset value should be a finite. Given %s',
        lockOffset
      );

      if (unit === '%') {
        offsetX = offsetX * this.width / 100;
        offsetY = offsetY * this.height / 100;
      }

      return {
        x: offsetX,
        y: offsetY,
      };
    }

    updatePosition(e) {
      const {lockAxis, lockToContainerEdges} = this.props;

      const offset = this.getOffset(e);
      const translate = {
        x: offset.x - this.initialOffset.x,
        y: offset.y - this.initialOffset.y,
      };
      // Adjust for window scroll
      translate.y -= (window.pageYOffset - this.initialWindowScroll.top);
      translate.x -= (window.pageXOffset - this.initialWindowScroll.left);

      this.translate = translate;

      if (lockToContainerEdges) {
        const [minLockOffset, maxLockOffset] = this.getLockPixelOffsets();
        const minOffset = {
          x: this.width / 2 - minLockOffset.x,
          y: this.height / 2 - minLockOffset.y,
        };
        const maxOffset = {
          x: this.width / 2 - maxLockOffset.x,
          y: this.height / 2 - maxLockOffset.y,
        };

        translate.x = limit(
          this.minTranslate.x + minOffset.x,
          this.maxTranslate.x - maxOffset.x,
          translate.x
        );
        translate.y = limit(
          this.minTranslate.y + minOffset.y,
          this.maxTranslate.y - maxOffset.y,
          translate.y
        );
      }

      if (lockAxis === 'x') {
        translate.y = 0;
      } else if (lockAxis === 'y') {
        translate.x = 0;
      }

      if (this.helper) {
        this.helper.style['Transform'] = `translate3d(${translate.x}px,${translate.y}px, 0)`;
      }

    }

    animateNodes() {
      const {transitionDuration, hideSortableGhost, onSortHover, canSortDrop} = this.props;
      const {isOrigin} = this.state;
      const nodes = this.manager.getOrderedRefs();
      const deltaScroll = {
        left: this.scrollContainer.scrollLeft - this.initialScroll.left,
        top: this.scrollContainer.scrollTop - this.initialScroll.top,
      };
      const sortingOffset = {
        left: this.offsetEdge.left + this.translate.x + deltaScroll.left,
        top: this.offsetEdge.top + this.translate.y + deltaScroll.top,
      };
      const scrollDifference = {
        top: (window.pageYOffset - this.initialWindowScroll.top),
        left: (window.pageXOffset - this.initialWindowScroll.left),
      };
      this.newIndex = null;

      for (let i = 0, len = nodes.length; i < len; i++) {
        const {node} = nodes[i];
        const index = node.sortableInfo.index;
        const width = node.offsetWidth;
        const height = node.offsetHeight;
        const offset = {
          width: this.width > width ? width / 2 : this.width / 2,
          height: this.height > height ? height / 2 : this.height / 2,
        };

        const translate = {
          x: 0,
          y: 0,
        };
        let {edgeOffset} = nodes[i];

        // If we haven't cached the node's offsetTop / offsetLeft value
        if (!edgeOffset) {
          nodes[i].edgeOffset = (edgeOffset = this.getEdgeOffset(node));
        }

        // Get a reference to the next and previous node
        const nextNode = i < nodes.length - 1 && nodes[i + 1];
        const prevNode = i > 0 && nodes[i - 1];

        // Also cache the next node's edge offset if needed.
        // We need this for calculating the animation in a grid setup
        if (nextNode && !nextNode.edgeOffset) {
          nextNode.edgeOffset = this.getEdgeOffset(nextNode.node);
        }

        // If the node is the one we're currently animating, skip it
        if (index === this.index) {
          if (hideSortableGhost) {
            /*
             * With windowing libraries such as `react-virtualized`, the sortableGhost
             * node may change while scrolling down and then back up (or vice-versa),
             * so we need to update the reference to the new node just to be safe.
             */
            this.sortableGhost = node;
            node.style.visibility = 'hidden';
            node.style.opacity = 0;
          }
          continue;
        }

        if (this.axis.x) {
          if (this.axis.y) {
            // Calculations for a grid setup
            if (
              index < this.index &&
              (
                ((sortingOffset.left + scrollDifference.left) - offset.width <= edgeOffset.left &&
                (sortingOffset.top + scrollDifference.top) <= edgeOffset.top + offset.height) ||
                (sortingOffset.top + scrollDifference.top) + offset.height <= edgeOffset.top
              )
            ) {
              // If the current node is to the left on the same row, or above the node that's being dragged
              // then move it to the right
              translate.x = this.width + this.marginOffset.x;
              if (
                edgeOffset.left + translate.x >
                this.containerBoundingRect.width - offset.width
              ) {
                // If it moves passed the right bounds, then animate it to the first position of the next row.
                // We just use the offset of the next node to calculate where to move, because that node's original position
                // is exactly where we want to go
                translate.x = nextNode.edgeOffset.left - edgeOffset.left;
                translate.y = nextNode.edgeOffset.top - edgeOffset.top;
              }
              if (this.newIndex === null) {
                this.newIndex = index;
              }
            } else if (
              index > this.index &&
              (
                ((sortingOffset.left + scrollDifference.left) + offset.width >= edgeOffset.left &&
                (sortingOffset.top + scrollDifference.top) + offset.height >= edgeOffset.top) ||
                (sortingOffset.top + scrollDifference.top) + offset.height >= edgeOffset.top + height
              )
            ) {
              // If the current node is to the right on the same row, or below the node that's being dragged
              // then move it to the left
              translate.x = -(this.width + this.marginOffset.x);
              if (
                edgeOffset.left + translate.x <
                this.containerBoundingRect.left + offset.width
              ) {
                // If it moves passed the left bounds, then animate it to the last position of the previous row.
                // We just use the offset of the previous node to calculate where to move, because that node's original position
                // is exactly where we want to go
                translate.x = prevNode.edgeOffset.left - edgeOffset.left;
                translate.y = prevNode.edgeOffset.top - edgeOffset.top;
              }
              this.newIndex = index;
            }
          } else {
            if (
              index > this.index &&
              (sortingOffset.left + scrollDifference.left) + offset.width >= edgeOffset.left
            ) {
              translate.x = -(this.width + this.marginOffset.x);
              this.newIndex = index;
            } else if (
              (!isOrigin || index < this.index) &&
              (sortingOffset.left + scrollDifference.left) <= edgeOffset.left + offset.width
            ) {
              translate.x = this.width + this.marginOffset.x;
              if (this.newIndex == null) {
                this.newIndex = index;
              }
            }
          }
        } else if (this.axis.y) {
          const draggedTop = sortingOffset.top + scrollDifference.top;
          const draggedBottom = draggedTop + this.height;
          const edgeTop = edgeOffset.top;
          const edgeBottom = edgeTop + height;

          if (!isOrigin || index < this.index) {
            let shouldTranslate;
            if (onSortHover && draggedTop < edgeBottom && draggedTop > edgeTop) {
              const hoverFromBelow = node.sortableInfo.translate.y === 0;
              shouldTranslate = onSortHover({
                isOrigin,
                draggedIndex: this.index, draggedTop, draggedBottom,
                targetIndex: index, targetTop: edgeTop, targetBottom: edgeBottom,
                gapIndex: hoverFromBelow ? index + 1 : index,
                gapPosition: hoverFromBelow ? 'BELOW' : 'ABOVE',
              });
            }
            else
              shouldTranslate = draggedTop < edgeBottom;

            if (shouldTranslate) {
              translate.y = this.height + this.marginOffset.y;
              if (this.newIndex == null)
                this.newIndex = index;
            }
          }
          else if (index > this.index) {
            let shouldTranslate;
            if (onSortHover && draggedBottom > edgeTop && draggedBottom < edgeBottom) {
              const hoverFromAbove = node.sortableInfo.translate.y === 0;
              shouldTranslate = onSortHover({
                isOrigin,
                draggedIndex: this.index, draggedTop, draggedBottom,
                targetIndex: index, targetTop: edgeTop, targetBottom: edgeBottom,
                gapIndex: hoverFromAbove ? index - 1 : index,
                gapPosition: hoverFromAbove ? 'ABOVE' : 'BELOW',
              });
            }
            else
              shouldTranslate = draggedBottom > edgeTop;

            if (shouldTranslate) {
              translate.y = -(this.height + this.marginOffset.y);
              this.newIndex = index;
            }
          }
        }

        node.sortableInfo.translate = translate;
      }

      if (this.newIndex == null) {
        this.newIndex = this.index;
      }

      // Perform translations if drop is allowed
      const isDropAllowed = !canSortDrop || canSortDrop({isOrigin, oldIndex: this.index, newIndex: this.newIndex, collection: this.manager.active.collection});
      for (let i = 0, len = nodes.length; i < len; i++) {
        const {node} = nodes[i];
        const {translate} = node.sortableInfo;
        if (!translate)
          continue;

        // Reset translation if drop is not allowed
        if (!isDropAllowed) {
          translate.x = 0;
          translate.y = 0;
        }

        if (transitionDuration) {
          node.style['TransitionDuration'] = `${transitionDuration}ms`;
        }

        node.style['Transform'] = `translate3d(${translate.x}px,${translate.y}px,0)`;
      }

      if (!isDropAllowed) {
        this.newIndex = this.index;
      }
    }

    autoscroll = () => {
      const translate = this.translate;
      const direction = {
        x: 0,
        y: 0,
      };
      const speed = {
        x: 1,
        y: 1,
      };
      const acceleration = {
        x: 10,
        y: 10,
      };

      if (translate.y >= this.maxTranslate.y - this.height / 2) {
        direction.y = 1; // Scroll Down
        speed.y = acceleration.y * Math.abs((this.maxTranslate.y - this.height / 2 - translate.y) / this.height);
      } else if (translate.x >= this.maxTranslate.x - this.width / 2) {
        direction.x = 1; // Scroll Right
        speed.x = acceleration.x * Math.abs((this.maxTranslate.x - this.width / 2 - translate.x) / this.width);
      } else if (translate.y <= this.minTranslate.y + this.height / 2) {
        direction.y = -1; // Scroll Up
        speed.y = acceleration.y * Math.abs((translate.y - this.height / 2 - this.minTranslate.y) / this.height);
      } else if (translate.x <= this.minTranslate.x + this.width / 2) {
        direction.x = -1; // Scroll Left
        speed.x = acceleration.x * Math.abs((translate.x - this.width / 2 - this.minTranslate.x) / this.width);
      }

      if (this.autoscrollInterval) {
        clearInterval(this.autoscrollInterval);
        this.autoscrollInterval = null;
        this.isAutoScrolling = false;
      }

      if (direction.x !== 0 || direction.y !== 0) {
        this.autoscrollInterval = setInterval(
          () => {
            this.isAutoScrolling = true;
            const offset = {
              left: 1 * speed.x * direction.x,
              top: 1 * speed.y * direction.y,
            };
            this.scrollContainer.scrollTop += offset.top;
            this.scrollContainer.scrollLeft += offset.left;
            this.translate.x += offset.left;
            this.translate.y += offset.top;
            this.animateNodes();
          },
          5
        );
      }
    };

    getWrappedInstance() {
      invariant(
        config.withRef,
        'To access the wrapped instance, you need to pass in {withRef: true} as the second argument of the SortableContainer() call'
      );
      return this.refs.wrappedInstance;
    }

    render() {
      const ref = config.withRef ? 'wrappedInstance' : null;

      return (
        <WrappedComponent
          ref={ref}
          {...omit(
            this.props,
            'contentWindow',
            'useWindowAsScrollContainer',
            'distance',
            'helperClass',
            'hideSortableGhost',
            'transitionDuration',
            'useDragHandle',
            'pressDelay',
            'pressThreshold',
            'shouldCancelStart',
            'onSortStart',
            'onSortMove',
            'onSortEnd',
            'axis',
            'lockAxis',
            'lockOffset',
            'lockToContainerEdges',
            'getContainer',
            'getHelperDimensions'
          )}
        />
      );
    }
  };
}
