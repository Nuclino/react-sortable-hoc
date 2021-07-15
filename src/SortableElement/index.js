import React, {Component} from 'react';
import PropTypes from 'prop-types';
import {findDOMNode} from 'react-dom';
import invariant from 'invariant';

import {provideDisplayName, omit} from '../utils';

// Export Higher Order Sortable Element Component
export default function sortableElement(WrappedComponent, config = {withRef: false}) {
  return class extends Component {
    static displayName = provideDisplayName('sortableElement', WrappedComponent);

    static contextTypes = {
      manager: PropTypes.object.isRequired,
    };

    static propTypes = {
      index: PropTypes.number.isRequired,
      collection: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      disabled: PropTypes.bool,
    };

    static defaultProps = {
      collection: 0,
    };

    componentDidMount() {
      const {collection, disabled, index} = this.props;

      if (!disabled) {
        this.setDraggable(collection, index);
      }
    }

    componentDidUpdate(prevProps) {
      if (prevProps.index !== this.props.index && this.node) {
        this.node.sortableInfo.index = this.props.index;
      }
      if (prevProps.disabled !== this.props.disabled) {
        const {collection, disabled, index} = this.props;
        if (disabled) {
          this.removeDraggable(collection);
        } else {
          this.setDraggable(collection, index);
        }
      } else if (prevProps.collection !== this.props.collection) {
        this.removeDraggable(this.props.collection);
        this.setDraggable(this.props.collection, this.props.index);
      }
    }

    componentWillUnmount() {
      const {collection, disabled} = this.props;

      if (!disabled) this.removeDraggable(collection);
    }

    setDraggable(collection, index) {
      const node = (this.node = findDOMNode(this));

      node.sortableInfo = {
        index,
        collection,
        manager: this.context.manager,
        translate: { x: 0, y: 0 },
      };

      this.ref = {node};
      this.context.manager.add(collection, this.ref);
    }

    removeDraggable(collection) {
      this.context.manager.remove(collection, this.ref);
    }

    getWrappedInstance() {
      invariant(
        config.withRef,
        'To access the wrapped instance, you need to pass in {withRef: true} as the second argument of the SortableElement() call'
      );
      return this.refs.wrappedInstance;
    }

    render() {
      const ref = config.withRef ? 'wrappedInstance' : null;

      return (
        <WrappedComponent
          ref={ref}
          {...omit(this.props, 'collection', 'disabled', 'index')}
        />
      );
    }
  };
}
